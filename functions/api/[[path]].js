import { Hono } from 'hono';
import { signJwt, verifyJwt } from '../_utils/jwt';
import { hashPassword, verifyPassword } from '../_utils/password';

const app = new Hono();
// 统一错误处理，便于定位 1101
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: '服务器错误', detail: err?.message || '' }, 500);
});

// 必须绑定 D1，否则返回 503
app.use('/api/*', async (c, next) => {
  if (!c.env || !c.env.DB) return c.json({ error: 'D1 未配置或未绑定 (DB)' }, 503);
  await next();
});

const run = (env, sql, ...bind) => env.DB.prepare(sql).bind(...bind).run();
const all = async (env, sql, ...bind) => {
  const res = await env.DB.prepare(sql).bind(...bind).all();
  return res?.results || [];
};
const first = (env, sql, ...bind) => env.DB.prepare(sql).bind(...bind).first();

const getClientIp = (c) => {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('CF-Connecting-IP') || '';
};

const buildPublicUrl = (env, key) => {
  if (!key) return '';
  if (env.R2_PUBLIC_BASE) return `${env.R2_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
  // 无公共域名时返回 key，用户可按自身 R2 域名拼接
  return key;
};

const auth = async (c, next) => {
  const authHeader = c.req.header('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return c.json({ error: '未授权' }, 401);
  const token = authHeader.slice(7);
  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (!payload) return c.json({ error: '未授权' }, 401);
    c.set('user', payload);
    await next();
  } catch (err) {
    console.error('auth error', err);
    return c.json({ error: '未授权' }, 401);
  }
};

const ensureAdmin = async (env) => {
  const row = await first(env, 'SELECT COUNT(*) AS count FROM users');
  if (row && row.count > 0) return;
  const username = env.ADMIN_USERNAME || 'admin';
  const password = env.ADMIN_PASSWORD || '123456';
  const passwordHash = await hashPassword(password);
  await run(env, 'INSERT INTO users (username, password) VALUES (?, ?)', username, passwordHash);
};

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/login', async (c) => {
  try {
    await ensureAdmin(c.env);
    const { username, password } = await c.req.json();
    const user = await first(c.env, 'SELECT * FROM users WHERE username = ?', username);
    if (!user) return c.json({ error: '用户名或密码错误' }, 401);
    const passOk = await verifyPassword(password, user.password);
    if (!passOk) return c.json({ error: '用户名或密码错误' }, 401);
    const token = await signJwt(
      { id: user.id, username: user.username, exp: Math.floor(Date.now() / 1000) + 7200 },
      c.env.JWT_SECRET
    );
    await run(
      c.env,
      'UPDATE users SET last_login_time=?, last_login_ip=? WHERE id=?',
      new Date().toISOString(),
      getClientIp(c),
      user.id
    );
    return c.json({ token, lastLoginTime: user.last_login_time, lastLoginIp: user.last_login_ip });
  } catch (err) {
    console.error('login error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

// 菜单 & 子菜单
app.get('/api/menus', async (c) => {
  try {
    const page = Number(c.req.query('page'));
    const size = Number(c.req.query('pageSize'));
    if (!page || !size) {
      const menus = await all(c.env, 'SELECT * FROM menus ORDER BY "order"');
      const subMenus = await all(c.env, 'SELECT * FROM sub_menus ORDER BY "order"');
      const grouped = subMenus.reduce((acc, item) => {
        acc[item.parent_id] = acc[item.parent_id] || [];
        acc[item.parent_id].push(item);
        return acc;
      }, {});
      const result = menus.map((m) => ({ ...m, subMenus: grouped[m.id] || [] }));
      return c.json(result);
    }
    const offset = (page - 1) * size;
    const countRow = await first(c.env, 'SELECT COUNT(*) AS total FROM menus');
    const rows = await all(c.env, 'SELECT * FROM menus ORDER BY "order" LIMIT ? OFFSET ?', size, offset);
    return c.json({ total: countRow?.total || 0, page, pageSize: size, data: rows });
  } catch (err) {
    console.error('get menus error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.get('/api/menus/:id/submenus', async (c) => {
  try {
    const { id } = c.req.param();
    const rows = await all(c.env, 'SELECT * FROM sub_menus WHERE parent_id = ? ORDER BY "order"', id);
    return c.json(rows);
  } catch (err) {
    console.error('get submenus error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.post('/api/menus', auth, async (c) => {
  try {
    const { name, order = 0 } = await c.req.json();
    const result = await run(c.env, 'INSERT INTO menus (name, "order") VALUES (?, ?)', name, order);
    return c.json({ id: result.lastRowId });
  } catch (err) {
    console.error('create menu error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.put('/api/menus/:id', auth, async (c) => {
  try {
    const { name, order = 0 } = await c.req.json();
    const { id } = c.req.param();
    const result = await run(c.env, 'UPDATE menus SET name=?, "order"=? WHERE id=?', name, order, id);
    return c.json({ changed: result.changes });
  } catch (err) {
    console.error('update menu error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.delete('/api/menus/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const result = await run(c.env, 'DELETE FROM menus WHERE id=?', id);
    return c.json({ deleted: result.changes });
  } catch (err) {
    console.error('delete menu error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.post('/api/menus/:id/submenus', auth, async (c) => {
  try {
    const { name, order = 0 } = await c.req.json();
    const { id } = c.req.param();
    const result = await run(
      c.env,
      'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)',
      id,
      name,
      order
    );
    return c.json({ id: result.lastRowId });
  } catch (err) {
    console.error('create submenu error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.put('/api/menus/submenus/:id', auth, async (c) => {
  try {
    const { name, order = 0 } = await c.req.json();
    const { id } = c.req.param();
    const result = await run(c.env, 'UPDATE sub_menus SET name=?, "order"=? WHERE id=?', name, order, id);
    return c.json({ changed: result.changes });
  } catch (err) {
    console.error('update submenu error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.delete('/api/menus/submenus/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const result = await run(c.env, 'DELETE FROM sub_menus WHERE id=?', id);
    return c.json({ deleted: result.changes });
  } catch (err) {
    console.error('delete submenu error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

// 卡片
app.get('/api/cards/:menuId', async (c) => {
  try {
    const { menuId } = c.req.param();
    const subMenuId = c.req.query('subMenuId');
    let rows;
    if (subMenuId) {
      rows = await all(
        c.env,
        'SELECT * FROM cards WHERE sub_menu_id = ? ORDER BY "order"',
        subMenuId
      );
    } else {
      rows = await all(
        c.env,
        'SELECT * FROM cards WHERE menu_id = ? AND sub_menu_id IS NULL ORDER BY "order"',
        menuId
      );
    }
    const display = rows.map((card) => {
      const cloned = { ...card };
      if (card.custom_logo_path) {
        cloned.display_logo = buildPublicUrl(c.env, card.custom_logo_path);
      } else if (card.logo_url) {
        cloned.display_logo = card.logo_url;
      } else {
        try {
          const url = new URL(card.url);
          cloned.display_logo = `${url.origin}/favicon.ico`;
        } catch {
          cloned.display_logo = '/default-favicon.png';
        }
      }
      return cloned;
    });
    return c.json(display);
  } catch (err) {
    console.error('get cards error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.post('/api/cards', auth, async (c) => {
  try {
    const { menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, order = 0 } = await c.req.json();
    const result = await run(
      c.env,
      'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      menu_id,
      sub_menu_id || null,
      title,
      url,
      logo_url,
      custom_logo_path,
      desc,
      order
    );
    return c.json({ id: result.lastRowId });
  } catch (err) {
    console.error('create card error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.put('/api/cards/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const { menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, order = 0 } = await c.req.json();
    const result = await run(
      c.env,
      'UPDATE cards SET menu_id=?, sub_menu_id=?, title=?, url=?, logo_url=?, custom_logo_path=?, desc=?, "order"=? WHERE id=?',
      menu_id,
      sub_menu_id || null,
      title,
      url,
      logo_url,
      custom_logo_path,
      desc,
      order,
      id
    );
    return c.json({ changed: result.changes });
  } catch (err) {
    console.error('update card error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.delete('/api/cards/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const result = await run(c.env, 'DELETE FROM cards WHERE id=?', id);
    return c.json({ deleted: result.changes });
  } catch (err) {
    console.error('delete card error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

// 广告
app.get('/api/ads', async (c) => {
  try {
    const page = Number(c.req.query('page'));
    const size = Number(c.req.query('pageSize'));
    if (!page || !size) {
      const rows = await all(c.env, 'SELECT * FROM ads');
      return c.json(rows);
    }
    const offset = (page - 1) * size;
    const countRow = await first(c.env, 'SELECT COUNT(*) AS total FROM ads');
    const rows = await all(c.env, 'SELECT * FROM ads LIMIT ? OFFSET ?', size, offset);
    return c.json({ total: countRow?.total || 0, page, pageSize: size, data: rows });
  } catch (err) {
    console.error('get ads error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.post('/api/ads', auth, async (c) => {
  try {
    const { position, img, url } = await c.req.json();
    const result = await run(c.env, 'INSERT INTO ads (position, img, url) VALUES (?, ?, ?)', position, img, url);
    return c.json({ id: result.lastRowId });
  } catch (err) {
    console.error('create ad error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.put('/api/ads/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const { img, url } = await c.req.json();
    const result = await run(c.env, 'UPDATE ads SET img=?, url=? WHERE id=?', img, url, id);
    return c.json({ changed: result.changes });
  } catch (err) {
    console.error('update ad error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.delete('/api/ads/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const result = await run(c.env, 'DELETE FROM ads WHERE id=?', id);
    return c.json({ deleted: result.changes });
  } catch (err) {
    console.error('delete ad error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

// 友链
app.get('/api/friends', async (c) => {
  try {
    const page = Number(c.req.query('page'));
    const size = Number(c.req.query('pageSize'));
    if (!page || !size) {
      const rows = await all(c.env, 'SELECT * FROM friends');
      return c.json(rows);
    }
    const offset = (page - 1) * size;
    const countRow = await first(c.env, 'SELECT COUNT(*) AS total FROM friends');
    const rows = await all(c.env, 'SELECT * FROM friends LIMIT ? OFFSET ?', size, offset);
    return c.json({ total: countRow?.total || 0, page, pageSize: size, data: rows });
  } catch (err) {
    console.error('get friends error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.post('/api/friends', auth, async (c) => {
  try {
    const { title, url, logo } = await c.req.json();
    const result = await run(c.env, 'INSERT INTO friends (title, url, logo) VALUES (?, ?, ?)', title, url, logo);
    return c.json({ id: result.lastRowId });
  } catch (err) {
    console.error('create friend error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.put('/api/friends/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const { title, url, logo } = await c.req.json();
    const result = await run(c.env, 'UPDATE friends SET title=?, url=?, logo=? WHERE id=?', title, url, logo, id);
    return c.json({ changed: result.changes });
  } catch (err) {
    console.error('update friend error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

app.delete('/api/friends/:id', auth, async (c) => {
  try {
    const { id } = c.req.param();
    const result = await run(c.env, 'DELETE FROM friends WHERE id=?', id);
    return c.json({ deleted: result.changes });
  } catch (err) {
    console.error('delete friend error', err);
    return c.json({ error: '服务器错误' }, 500);
  }
});

// 用户
app.get('/api/users/profile', auth, async (c) => {
  try {
    const user = c.get('user');
    const row = await first(c.env, 'SELECT id, username FROM users WHERE id=?', user.id);
    if (!row) return c.json({ message: '用户不存在' }, 404);
    return c.json({ data: row });
  } catch (err) {
    console.error('profile error', err);
    return c.json({ message: '服务器错误' }, 500);
  }
});

app.get('/api/users/me', auth, async (c) => {
  try {
    const user = c.get('user');
    const row = await first(
      c.env,
      'SELECT id, username, last_login_time, last_login_ip FROM users WHERE id = ?',
      user.id
    );
    if (!row) return c.json({ message: '用户不存在' }, 404);
    return c.json({ last_login_time: row.last_login_time, last_login_ip: row.last_login_ip });
  } catch (err) {
    console.error('me error', err);
    return c.json({ message: '服务器错误' }, 500);
  }
});

app.put('/api/users/password', auth, async (c) => {
  try {
    const { oldPassword, newPassword } = await c.req.json();
    if (!oldPassword || !newPassword) return c.json({ message: '请提供旧密码和新密码' }, 400);
    if (newPassword.length < 6) return c.json({ message: '新密码长度至少6位' }, 400);
    const user = c.get('user');
    const row = await first(c.env, 'SELECT password FROM users WHERE id = ?', user.id);
    if (!row) return c.json({ message: '用户不存在' }, 404);
    const valid = await verifyPassword(oldPassword, row.password);
    if (!valid) return c.json({ message: '旧密码错误' }, 400);
    const newHash = await hashPassword(newPassword);
    await run(c.env, 'UPDATE users SET password = ? WHERE id = ?', newHash, user.id);
    return c.json({ message: '密码修改成功' });
  } catch (err) {
    console.error('change password error', err);
    return c.json({ message: '服务器错误' }, 500);
  }
});

app.get('/api/users', auth, async (c) => {
  try {
    const page = Number(c.req.query('page'));
    const size = Number(c.req.query('pageSize'));
    if (!page || !size) {
      const users = await all(c.env, 'SELECT id, username FROM users');
      return c.json({ data: users });
    }
    const offset = (page - 1) * size;
    const countRow = await first(c.env, 'SELECT COUNT(*) AS total FROM users');
    const users = await all(c.env, 'SELECT id, username FROM users LIMIT ? OFFSET ?', size, offset);
    return c.json({ total: countRow?.total || 0, page, pageSize: size, data: users });
  } catch (err) {
    console.error('get users error', err);
    return c.json({ message: '服务器错误' }, 500);
  }
});

// 上传到 R2
app.post('/api/upload', auth, async (c) => {
  try {
    if (!c.env || !c.env.R2) return c.json({ error: 'R2 未配置或未绑定 (R2)' }, 503);
    const formData = await c.req.formData();
    const file = formData.get('logo');
    if (!(file instanceof File)) return c.json({ error: '未找到上传文件' }, 400);
    const ext = (() => {
      const name = file.name || '';
      const idx = name.lastIndexOf('.');
      return idx >= 0 ? name.slice(idx) : '';
    })();
    const key = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
    await c.env.R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });
    const url = buildPublicUrl(c.env, key);
    return c.json({ filename: key, url });
  } catch (err) {
    console.error('upload error', err);
    return c.json({ error: '上传失败' }, 500);
  }
});

// Pages Functions 入口，适配 context 对象形态
export const onRequest = (context) => app.fetch(context.request, context.env, context);
