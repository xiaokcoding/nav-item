import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { parseBookmarkHtml, generateImportPlan, MAX_FILE_SIZE } from '../lib/bookmark-parser.js';

const app = new Hono();

function getClientIp(c) {
  let ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip;
}

function getShanghaiTime() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false });
}

async function requireAuth(c, next) {
  const auth = c.req.header('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ error: '未授权' }, 401);
  }
  const token = auth.slice(7);
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    c.set('user', payload);
    await next();
  } catch (e) {
    return c.json({ error: '无效token' }, 401);
  }
}

async function ensureAdmin(c) {
  const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
  if ((row?.count || 0) > 0) return null;
  const username = c.env.ADMIN_USERNAME;
  const password = c.env.ADMIN_PASSWORD;
  if (!username || !password) {
    return c.json({ error: '管理员账号未配置' }, 500);
  }
  const hash = await bcrypt.hash(password, 10);
  await c.env.DB.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
    .bind(username, hash)
    .run();
  return null;
}

app.get('/api/health', (c) => {
  return c.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post('/api/login', async (c) => {
  const bootstrapRes = await ensureAdmin(c);
  if (bootstrapRes) return bootstrapRes;
  const body = await c.req.json();
  const username = body?.username;
  const password = body?.password;
  if (!username || !password) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username=?')
    .bind(username)
    .first();
  if (!user) return c.json({ error: '用户名或密码错误' }, 401);

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return c.json({ error: '用户名或密码错误' }, 401);

  const lastLoginTime = user.last_login_time;
  const lastLoginIp = user.last_login_ip;
  const now = getShanghaiTime();
  const ip = getClientIp(c);
  await c.env.DB.prepare('UPDATE users SET last_login_time=?, last_login_ip=? WHERE id=?')
    .bind(now, ip, user.id)
    .run();

  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  const token = await new SignJWT({ id: user.id, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(secret);

  return c.json({ token, lastLoginTime, lastLoginIp });
});

app.get('/api/menus', async (c) => {
  const page = c.req.query('page');
  const pageSize = c.req.query('pageSize');
  if (!page && !pageSize) {
    const menusRes = await c.env.DB.prepare('SELECT * FROM menus ORDER BY "order"').all();
    const menus = menusRes.results || [];
    const menusWithSubMenus = await Promise.all(
      menus.map(async (menu) => {
        const subRes = await c.env.DB.prepare(
          'SELECT * FROM sub_menus WHERE parent_id = ? ORDER BY "order"'
        ).bind(menu.id).all();
        return { ...menu, subMenus: subRes.results || [] };
      })
    );
    return c.json(menusWithSubMenus);
  }

  const pageNum = parseInt(page || '1', 10) || 1;
  const size = parseInt(pageSize || '10', 10) || 10;
  const offset = (pageNum - 1) * size;
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM menus').first();
  const rows = await c.env.DB.prepare('SELECT * FROM menus ORDER BY "order" LIMIT ? OFFSET ?')
    .bind(size, offset)
    .all();
  return c.json({
    total: countRow?.total || 0,
    page: pageNum,
    pageSize: size,
    data: rows.results || []
  });
});

app.get('/api/menus/:id/submenus', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM sub_menus WHERE parent_id = ? ORDER BY "order"'
  ).bind(c.req.param('id')).all();
  return c.json(rows.results || []);
});

app.post('/api/menus', requireAuth, async (c) => {
  const body = await c.req.json();
  const name = body?.name;
  const order = body?.order || 0;
  const result = await c.env.DB.prepare(
    'INSERT INTO menus (name, "order") VALUES (?, ?)'
  ).bind(name, order).run();
  return c.json({ id: result.meta.last_row_id });
});

app.put('/api/menus/:id', requireAuth, async (c) => {
  const body = await c.req.json();
  const name = body?.name;
  const order = body?.order || 0;
  const result = await c.env.DB.prepare(
    'UPDATE menus SET name=?, "order"=? WHERE id=?'
  ).bind(name, order, c.req.param('id')).run();
  return c.json({ changed: result.meta.changes });
});

app.delete('/api/menus/:id', requireAuth, async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM menus WHERE id=?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ deleted: result.meta.changes });
});

app.post('/api/menus/:id/submenus', requireAuth, async (c) => {
  const body = await c.req.json();
  const name = body?.name;
  const order = body?.order || 0;
  const result = await c.env.DB.prepare(
    'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)'
  ).bind(c.req.param('id'), name, order).run();
  return c.json({ id: result.meta.last_row_id });
});

app.put('/api/menus/submenus/:id', requireAuth, async (c) => {
  const body = await c.req.json();
  const name = body?.name;
  const order = body?.order || 0;
  const result = await c.env.DB.prepare(
    'UPDATE sub_menus SET name=?, "order"=? WHERE id=?'
  ).bind(name, order, c.req.param('id')).run();
  return c.json({ changed: result.meta.changes });
});

app.delete('/api/menus/submenus/:id', requireAuth, async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM sub_menus WHERE id=?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ deleted: result.meta.changes });
});

app.get('/api/cards/:menuId', async (c) => {
  const menuId = c.req.param('menuId');
  const subMenuId = c.req.query('subMenuId');
  let query = '';
  let params = [];

  if (subMenuId) {
    query = 'SELECT * FROM cards WHERE sub_menu_id = ? ORDER BY "order"';
    params = [subMenuId];
  } else {
    query = 'SELECT * FROM cards WHERE menu_id = ? AND sub_menu_id IS NULL ORDER BY "order"';
    params = [menuId];
  }

  const rows = await c.env.DB.prepare(query).bind(...params).all();
  const data = (rows.results || []).map((card) => {
    if (!card.custom_logo_path) {
      const base = card.logo_url || (card.url || '').replace(/\/+$/, '') + '/favicon.ico';
      return { ...card, display_logo: base };
    }
    return { ...card, display_logo: '/uploads/' + card.custom_logo_path };
  });
  return c.json(data);
});

app.post('/api/cards', requireAuth, async (c) => {
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body?.menu_id ?? null,
    body?.sub_menu_id ?? null,
    body?.title ?? '',
    body?.url ?? '',
    body?.logo_url ?? null,
    body?.custom_logo_path ?? null,
    body?.desc ?? null,
    body?.order ?? 0
  ).run();
  return c.json({ id: result.meta.last_row_id });
});

app.put('/api/cards/:id', requireAuth, async (c) => {
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    'UPDATE cards SET menu_id=?, sub_menu_id=?, title=?, url=?, logo_url=?, custom_logo_path=?, desc=?, "order"=? WHERE id=?'
  ).bind(
    body?.menu_id ?? null,
    body?.sub_menu_id ?? null,
    body?.title ?? '',
    body?.url ?? '',
    body?.logo_url ?? null,
    body?.custom_logo_path ?? null,
    body?.desc ?? null,
    body?.order ?? 0,
    c.req.param('id')
  ).run();
  return c.json({ changed: result.meta.changes });
});

app.delete('/api/cards/:id', requireAuth, async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM cards WHERE id=?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ deleted: result.meta.changes });
});

app.post('/api/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('logo');
  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file uploaded' }, 400);
  }
  if (!c.env.UPLOADS) {
    return c.json({ error: 'UPLOADS binding not configured' }, 500);
  }

  const name = file.name || '';
  const extIndex = name.lastIndexOf('.');
  const ext = extIndex >= 0 ? name.slice(extIndex) : '';
  const filename = `${Date.now()}${ext}`;
  const data = await file.arrayBuffer();
  await c.env.UPLOADS.put(filename, data, {
    httpMetadata: { contentType: file.type }
  });

  return c.json({ filename, url: '/uploads/' + filename });
});

app.get('/api/friends', async (c) => {
  const page = c.req.query('page');
  const pageSize = c.req.query('pageSize');
  if (!page && !pageSize) {
    const rows = await c.env.DB.prepare('SELECT * FROM friends').all();
    return c.json(rows.results || []);
  }

  const pageNum = parseInt(page || '1', 10) || 1;
  const size = parseInt(pageSize || '10', 10) || 10;
  const offset = (pageNum - 1) * size;
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM friends').first();
  const rows = await c.env.DB.prepare('SELECT * FROM friends LIMIT ? OFFSET ?')
    .bind(size, offset)
    .all();
  return c.json({
    total: countRow?.total || 0,
    page: pageNum,
    pageSize: size,
    data: rows.results || []
  });
});

app.post('/api/friends', requireAuth, async (c) => {
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    'INSERT INTO friends (title, url, logo) VALUES (?, ?, ?)'
  ).bind(body?.title ?? '', body?.url ?? '', body?.logo ?? null).run();
  return c.json({ id: result.meta.last_row_id });
});

app.put('/api/friends/:id', requireAuth, async (c) => {
  const body = await c.req.json();
  const result = await c.env.DB.prepare(
    'UPDATE friends SET title=?, url=?, logo=? WHERE id=?'
  ).bind(body?.title ?? '', body?.url ?? '', body?.logo ?? null, c.req.param('id')).run();
  return c.json({ changed: result.meta.changes });
});

app.delete('/api/friends/:id', requireAuth, async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM friends WHERE id=?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ deleted: result.meta.changes });
});

app.get('/api/users/profile', requireAuth, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(user.id)
    .first();
  if (!row) return c.json({ message: '用户不存在' }, 404);
  return c.json({ data: row });
});

app.get('/api/users/me', requireAuth, async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT id, username, last_login_time, last_login_ip FROM users WHERE id = ?'
  ).bind(user.id).first();
  if (!row) return c.json({ message: '用户不存在' }, 404);
  return c.json({
    last_login_time: row.last_login_time,
    last_login_ip: row.last_login_ip
  });
});

app.put('/api/users/password', requireAuth, async (c) => {
  const body = await c.req.json();
  const oldPassword = body?.oldPassword;
  const newPassword = body?.newPassword;

  if (!oldPassword || !newPassword) {
    return c.json({ message: '请提供旧密码和新密码' }, 400);
  }
  if (newPassword.length < 6) {
    return c.json({ message: '新密码长度至少6位' }, 400);
  }

  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT password FROM users WHERE id = ?')
    .bind(user.id)
    .first();
  if (!row) return c.json({ message: '用户不存在' }, 404);

  const ok = await bcrypt.compare(oldPassword, row.password);
  if (!ok) return c.json({ message: '旧密码错误' }, 400);

  const hash = await bcrypt.hash(newPassword, 10);
  await c.env.DB.prepare('UPDATE users SET password = ? WHERE id = ?')
    .bind(hash, user.id)
    .run();
  return c.json({ message: '密码修改成功' });
});

app.get('/api/users', requireAuth, async (c) => {
  const page = c.req.query('page');
  const pageSize = c.req.query('pageSize');
  if (!page && !pageSize) {
    const rows = await c.env.DB.prepare('SELECT id, username FROM users').all();
    return c.json({ data: rows.results || [] });
  }

  const pageNum = parseInt(page || '1', 10) || 1;
  const size = parseInt(pageSize || '10', 10) || 10;
  const offset = (pageNum - 1) * size;
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM users').first();
  const rows = await c.env.DB.prepare('SELECT id, username FROM users LIMIT ? OFFSET ?')
    .bind(size, offset)
    .all();
  return c.json({
    total: countRow?.total || 0,
    page: pageNum,
    pageSize: size,
    data: rows.results || []
  });
});

// ==================== 书签导入 API ====================

/**
 * 加载已存在的菜单/分组/URL 数据
 */
async function loadExistingData(db, targetMenuId) {
  const existingMenus = new Map(); // name => id
  const existingGroups = new Map(); // menuId => Map<groupName, id>
  const existingUrls = new Map(); // "menuId-groupId" => Set<url>

  // 加载菜单
  const menusRes = await db.prepare('SELECT id, name FROM menus').all();
  for (const m of (menusRes.results || [])) {
    existingMenus.set(m.name, m.id);
  }

  // 加载分组
  const groupsRes = await db.prepare('SELECT id, parent_id, name FROM sub_menus').all();
  for (const g of (groupsRes.results || [])) {
    const parentKey = String(g.parent_id);
    if (!existingGroups.has(parentKey)) {
      existingGroups.set(parentKey, new Map());
    }
    existingGroups.get(parentKey).set(g.name, g.id);
  }

  // 加载 URL
  let cardsQuery = 'SELECT menu_id, sub_menu_id, url FROM cards';
  let cardsParams = [];
  if (targetMenuId) {
    cardsQuery += ' WHERE menu_id = ?';
    cardsParams = [targetMenuId];
  }
  const cardsRes = await db.prepare(cardsQuery).bind(...cardsParams).all();
  for (const c of (cardsRes.results || [])) {
    const key = `${c.menu_id}-${c.sub_menu_id || 'null'}`;
    if (!existingUrls.has(key)) {
      existingUrls.set(key, new Set());
    }
    existingUrls.get(key).add(c.url);
  }

  return { existingMenus, existingGroups, existingUrls };
}

/**
 * POST /api/import/bookmarks/preview
 * 预览导入计划，不写入数据库
 */
app.post('/api/import/bookmarks/preview', requireAuth, async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    const mode = formData.get('mode') || 'merge';
    const target = formData.get('target') || 'auto';

    if (!file || typeof file === 'string') {
      return c.json({ ok: false, error: '请上传书签 HTML 文件' }, 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ ok: false, error: `文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, 400);
    }

    const htmlContent = await file.text();
    if (!htmlContent || htmlContent.length < 10) {
      return c.json({ ok: false, error: '文件内容为空或无效' }, 400);
    }

    // 解析书签
    const { bookmarks, rootFolders, errors } = parseBookmarkHtml(htmlContent);
    if (bookmarks.length === 0) {
      return c.json({ ok: false, error: '未能从书签文件中解析出有效数据', errors }, 400);
    }

    // 解析 target
    const targetType = target === 'auto' ? 'auto' : 'menu';
    let targetMenuId = null;
    let targetMenuName = null;
    if (targetType === 'menu') {
      targetMenuId = parseInt(target.replace('menu:', ''), 10);
      if (isNaN(targetMenuId)) {
        return c.json({ ok: false, error: 'target 参数格式错误' }, 400);
      }
      const targetMenu = await c.env.DB.prepare('SELECT id, name FROM menus WHERE id = ?')
        .bind(targetMenuId).first();
      if (!targetMenu) {
        return c.json({ ok: false, error: `目标栏目 (id=${targetMenuId}) 不存在` }, 404);
      }
      targetMenuName = targetMenu.name;
    }

    // 加载现有数据
    const { existingMenus, existingGroups, existingUrls } = await loadExistingData(
      c.env.DB,
      targetType === 'menu' ? targetMenuId : null
    );

    // 替换模式下，清空目标范围的已有 URL
    if (mode === 'replace') {
      if (targetType === 'menu') {
        // 清空指定菜单的 URL
        for (const [key, urlSet] of existingUrls) {
          if (key.startsWith(`${targetMenuId}-`)) {
            urlSet.clear();
          }
        }
      } else {
        // 自动创建模式，清空本次涉及菜单的 URL
        const involvedMenuNames = new Set(rootFolders);
        // 检查是否有根级散书签
        if (bookmarks.some(b => b.rootFolder === null)) {
          involvedMenuNames.add('导入书签');
        }
        for (const menuName of involvedMenuNames) {
          const menuId = existingMenus.get(menuName);
          if (menuId) {
            for (const [key, urlSet] of existingUrls) {
              if (key.startsWith(`${menuId}-`)) {
                urlSet.clear();
              }
            }
          }
        }
      }
    }

    // 生成导入计划
    const plan = generateImportPlan({
      bookmarks,
      rootFolders,
      targetType,
      targetMenuId,
      targetMenuName,
      existingMenus,
      existingGroups,
      existingUrls
    });

    // 构建详细预览结构
    const menuDetails = plan.menus.map(m => {
      const groupsInMenu = plan.groups.filter(g => g.menuKey === m.key);
      const cardsDirectInMenu = plan.cards.filter(c => c.menuKey === m.key && !c.groupKey);
      return {
        name: m.name,
        action: m.action,
        groupCount: groupsInMenu.length,
        groups: groupsInMenu.map(g => {
          const cardsInGroup = plan.cards.filter(c => c.groupKey === g.key);
          return {
            name: g.name,
            action: g.action,
            cardCount: cardsInGroup.filter(c => c.action === 'create').length,
            skipCount: cardsInGroup.filter(c => c.action === 'skip').length
          };
        }),
        directCardCount: cardsDirectInMenu.filter(c => c.action === 'create').length,
        directSkipCount: cardsDirectInMenu.filter(c => c.action === 'skip').length
      };
    });

    // 样本书签
    const sample = plan.cards.slice(0, 10).map(c => ({ title: c.title, url: c.url }));

    return c.json({
      ok: true,
      mode,
      targetType,
      targetMenuId,
      targetMenuName,
      stats: plan.stats,
      menuDetails,
      sample,
      errors,
      // 返回 plan 用于确认导入
      plan
    });

  } catch (e) {
    console.error('Preview bookmarks error:', e);
    return c.json({ ok: false, error: `预览失败: ${e.message}` }, 500);
  }
});

/**
 * POST /api/import/bookmarks/apply
 * 根据 plan 执行实际导入
 */
app.post('/api/import/bookmarks/apply', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { plan, mode, targetType, targetMenuId } = body;

    if (!plan || !plan.menus || !plan.groups || !plan.cards) {
      return c.json({ ok: false, error: '无效的导入计划' }, 400);
    }

    const db = c.env.DB;
    const stats = {
      menus: { created: 0, reused: 0 },
      groups: { created: 0, reused: 0 },
      cards: { created: 0, skipped: 0 }
    };
    const errors = [];

    // ========== 替换模式: 先删除目标范围数据 ==========
    if (mode === 'replace') {
      const deleteStmts = [];

      if (targetType === 'menu' && targetMenuId) {
        // 删除指定菜单下的所有卡片和分组
        deleteStmts.push(db.prepare('DELETE FROM cards WHERE menu_id = ?').bind(targetMenuId));
        deleteStmts.push(db.prepare('DELETE FROM sub_menus WHERE parent_id = ?').bind(targetMenuId));
      } else {
        // 自动创建模式: 删除本次涉及的菜单
        for (const menuPlan of plan.menus) {
          if (menuPlan.existingId) {
            deleteStmts.push(db.prepare('DELETE FROM cards WHERE menu_id = ?').bind(menuPlan.existingId));
            deleteStmts.push(db.prepare('DELETE FROM sub_menus WHERE parent_id = ?').bind(menuPlan.existingId));
          }
        }
      }

      if (deleteStmts.length > 0) {
        await db.batch(deleteStmts);
      }
    }

    // ========== 创建/复用菜单 ==========
    const menuIdMap = new Map(); // menuKey => actual id

    for (const menuPlan of plan.menus) {
      if (menuPlan.action === 'reuse' && menuPlan.existingId) {
        menuIdMap.set(menuPlan.key, menuPlan.existingId);
        stats.menus.reused++;
      } else {
        // 创建新菜单
        const result = await db.prepare(
          'INSERT INTO menus (name, "order") VALUES (?, ?)'
        ).bind(menuPlan.name, menuPlan.order).run();
        menuIdMap.set(menuPlan.key, result.meta.last_row_id);
        stats.menus.created++;
      }
    }

    // ========== 创建/复用分组 ==========
    const groupIdMap = new Map(); // groupKey => actual id

    // 按 menuKey 分组，减少查询
    const groupsByMenu = new Map();
    for (const groupPlan of plan.groups) {
      if (!groupsByMenu.has(groupPlan.menuKey)) {
        groupsByMenu.set(groupPlan.menuKey, []);
      }
      groupsByMenu.get(groupPlan.menuKey).push(groupPlan);
    }

    for (const [menuKey, groups] of groupsByMenu) {
      const menuId = menuIdMap.get(menuKey);
      if (!menuId) continue;

      // 查询该菜单下已存在的分组
      const existingGroupsRes = await db.prepare(
        'SELECT id, name FROM sub_menus WHERE parent_id = ?'
      ).bind(menuId).all();
      const existingGroupMap = new Map();
      for (const g of (existingGroupsRes.results || [])) {
        existingGroupMap.set(g.name, g.id);
      }

      // 批量创建新分组
      const createStmts = [];
      const createGroups = [];

      for (const groupPlan of groups) {
        const existingId = existingGroupMap.get(groupPlan.name);
        if (existingId) {
          groupIdMap.set(groupPlan.key, existingId);
          stats.groups.reused++;
        } else {
          createStmts.push(
            db.prepare('INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)')
              .bind(menuId, groupPlan.name, groupPlan.order)
          );
          createGroups.push(groupPlan);
        }
      }

      if (createStmts.length > 0) {
        const results = await db.batch(createStmts);
        for (let i = 0; i < createGroups.length; i++) {
          groupIdMap.set(createGroups[i].key, results[i].meta.last_row_id);
          stats.groups.created++;
        }
      }
    }

    // ========== 批量创建卡片 ==========
    // 先收集需要创建的卡片
    const cardsToCreate = plan.cards.filter(c => c.action === 'create');
    stats.cards.skipped = plan.cards.filter(c => c.action === 'skip').length;

    // 分批执行（D1 batch 最多 100 条）
    const BATCH_SIZE = 100;
    for (let i = 0; i < cardsToCreate.length; i += BATCH_SIZE) {
      const batch = cardsToCreate.slice(i, i + BATCH_SIZE);
      const stmts = [];

      for (const card of batch) {
        const menuId = menuIdMap.get(card.menuKey);
        const groupId = card.groupKey ? groupIdMap.get(card.groupKey) : null;

        if (!menuId) {
          errors.push(`卡片 "${card.title}" 的菜单未找到`);
          continue;
        }

        stmts.push(
          db.prepare(
            'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(menuId, groupId, card.title, card.url, null, null, null, card.order)
        );
      }

      if (stmts.length > 0) {
        await db.batch(stmts);
        stats.cards.created += stmts.length;
      }
    }

    return c.json({
      ok: true,
      created: {
        menus: stats.menus.created,
        subMenus: stats.groups.created,
        cards: stats.cards.created
      },
      skipped: {
        menus: stats.menus.reused,
        subMenus: stats.groups.reused,
        cards: stats.cards.skipped
      },
      errors
    });

  } catch (e) {
    console.error('Apply bookmarks error:', e);
    return c.json({ ok: false, error: `导入失败: ${e.message}` }, 500);
  }
});

/**
 * POST /api/import/bookmarks (Deprecated, 兼容旧接口)
 */
app.post('/api/import/bookmarks', requireAuth, async (c) => {
  // 将旧接口请求转发到新流程
  const formData = await c.req.formData();
  const dryRunParam = formData.get('dryRun') || c.req.query('dryRun') || 'false';
  const dryRun = dryRunParam === 'true' || dryRunParam === true;

  if (dryRun) {
    // 预览模式
    const previewReq = new Request(c.req.url.replace('/bookmarks', '/bookmarks/preview'), {
      method: 'POST',
      headers: c.req.raw.headers,
      body: await c.req.raw.clone().blob()
    });
    return app.fetch(previewReq, c.env, c.executionCtx);
  } else {
    // 实际导入: 先预览再应用
    const file = formData.get('file');
    const mode = formData.get('mode') || 'merge';
    const target = formData.get('target') || 'auto';

    // 执行预览
    const newFormData = new FormData();
    newFormData.append('file', file);
    newFormData.append('mode', mode);
    newFormData.append('target', target);

    const previewReq = new Request(c.req.url.replace('/bookmarks', '/bookmarks/preview'), {
      method: 'POST',
      headers: { 'Authorization': c.req.header('authorization') },
      body: newFormData
    });
    const previewRes = await app.fetch(previewReq, c.env, c.executionCtx);
    const previewData = await previewRes.json();

    if (!previewData.ok) {
      return c.json(previewData, previewRes.status);
    }

    // 执行应用
    const targetType = target === 'auto' ? 'auto' : 'menu';
    const targetMenuId = targetType === 'menu' ? parseInt(target.replace('menu:', ''), 10) : null;

    const applyReq = new Request(c.req.url.replace('/bookmarks', '/bookmarks/apply'), {
      method: 'POST',
      headers: {
        'Authorization': c.req.header('authorization'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan: previewData.plan,
        mode,
        targetType,
        targetMenuId
      })
    });
    return app.fetch(applyReq, c.env, c.executionCtx);
  }
});

export const onRequest = (c) => app.fetch(c.request, c.env, c.executionCtx);
