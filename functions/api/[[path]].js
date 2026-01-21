import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

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

async function ensureSeed(c) {
  const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM menus').first();
  if ((row?.count || 0) > 0) return null;
  const statements = [
    'INSERT INTO menus (name, "order") VALUES' +
      "('Home', 1)," +
      "('Ai Stuff', 2)," +
      "('Cloud', 3)," +
      "('Software', 4)," +
      "('Tools', 5)," +
      "('Other', 6);",
    'INSERT INTO sub_menus (parent_id, name, "order") VALUES' +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), 'AI chat', 1)," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), 'AI tools', 2)," +
      "((SELECT id FROM menus WHERE name='Tools'), 'Dev Tools', 1)," +
      "((SELECT id FROM menus WHERE name='Software'), 'Mac', 1)," +
      "((SELECT id FROM menus WHERE name='Software'), 'iOS', 2)," +
      "((SELECT id FROM menus WHERE name='Software'), 'Android', 3)," +
      "((SELECT id FROM menus WHERE name='Software'), 'Windows', 4);",
    'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc) VALUES' +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Baidu', 'https://www.baidu.com', '', '全球最大的中文搜索引擎')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Youtube', 'https://www.youtube.com', 'https://img.icons8.com/ios-filled/100/ff1d06/youtube-play.png', '全球最大的视频社区')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Gmail', 'https://mail.google.com', 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico', '')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'GitHub', 'https://github.com', '', '全球最大的代码托管平台')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'ip.sb', 'https://ip.sb', '', 'ip地址查询')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Cloudflare', 'https://dash.cloudflare.com', '', '全球最大的cdn服务商')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'ChatGPT', 'https://chat.openai.com', 'https://cdn.oaistatic.com/assets/favicon-eex17e9e.ico', '人工智能AI聊天机器人')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Huggingface', 'https://huggingface.co', '', '全球最大的开源模型托管平台')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'ITDOG - 在线ping', 'https://www.itdog.cn/tcping', '', '在线tcping')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Ping0', 'https://ping0.cc', '', 'ip地址查询')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '浏览器指纹', 'https://www.browserscan.net/zh', '', '浏览器指纹查询')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'nezha面板', 'https://ssss.nyc.mn', 'https://nezha.wiki/logo.png', 'nezha面板')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Api测试', 'https://hoppscotch.io', '', '在线api测试工具')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '域名检查', 'https://who.cx', '', '域名可用性查询')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '域名比价', 'https://www.whois.com', '', '域名价格比较')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'NodeSeek', 'https://www.nodeseek.com', 'https://www.nodeseek.com/static/image/favicon/favicon-32x32.png', '主机论坛')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'Linux do', 'https://linux.do', 'https://linux.do/uploads/default/optimized/3X/9/d/9dd49731091ce8656e94433a26a3ef36062b3994_2_32x32.png', '新的理想型社区')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '在线音乐', 'https://music.eooce.com', 'https://p3.music.126.net/tBTNafgjNnTL1KlZMt7lVA==/18885211718935735.jpg', '在线音乐')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '在线电影', 'https://libretv.eooce.com', 'https://img.icons8.com/color/240/cinema---v1.png', '在线电影')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '免费接码', 'https://www.smsonline.cloud/zh', '', '免费接收短信验证码')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '订阅转换', 'https://sublink.eooce.com', 'https://img.icons8.com/color/96/link--v1.png', '最好用的订阅转换工具')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, 'webssh', 'https://ssh.eooce.com', 'https://img.icons8.com/fluency/240/ssh.png', '最好用的webssh终端管理工具')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '文件快递柜', 'https://filebox.nnuu.nyc.mn', 'https://img.icons8.com/nolan/256/document.png', '文件输出分享')," +
      "((SELECT id FROM menus WHERE name='Home'), NULL, '真实地址生成', 'https://address.nnuu.nyc.mn', 'https://static11.meiguodizhi.com/favicon.ico', '基于当前ip生成真实的地址')," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), NULL, 'ChatGPT', 'https://chat.openai.com', 'https://cdn.oaistatic.com/assets/favicon-eex17e9e.ico', 'OpenAI官方AI对话')," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), NULL, 'Deepseek', 'https://www.deepseek.com', 'https://cdn.deepseek.com/chat/icon.png', 'Deepseek AI搜索')," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), NULL, 'Claude', 'https://claude.ai', 'https://img.icons8.com/fluency/240/claude-ai.png', 'Anthropic Claude AI')," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), NULL, 'Google Gemini', 'https://gemini.google.com', 'https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg', 'Google Gemini大模型')," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), NULL, '阿里千问', 'https://chat.qwenlm.ai', 'https://g.alicdn.com/qwenweb/qwen-ai-fe/0.0.11/favicon.ico', '阿里云千问大模型')," +
      "((SELECT id FROM menus WHERE name='Ai Stuff'), NULL, 'Kimi', 'https://www.kimi.com', '', '月之暗面Moonshot AI')," +
      "(NULL, (SELECT id FROM sub_menus WHERE name='AI chat'), 'ChatGPT', 'https://chat.openai.com', 'https://cdn.oaistatic.com/assets/favicon-eex17e9e.ico', 'OpenAI官方AI对话')," +
      "(NULL, (SELECT id FROM sub_menus WHERE name='AI chat'), 'Deepseek', 'https://www.deepseek.com', 'https://cdn.deepseek.com/chat/icon.png', 'Deepseek AI搜索')," +
      "(NULL, (SELECT id FROM sub_menus WHERE name='AI tools'), 'ChatGPT', 'https://chat.openai.com', 'https://cdn.oaistatic.com/assets/favicon-eex17e9e.ico', 'OpenAI官方AI对话')," +
      "(NULL, (SELECT id FROM sub_menus WHERE name='AI tools'), 'Deepseek', 'https://www.deepseek.com', 'https://cdn.deepseek.com/chat/icon.png', 'Deepseek AI搜索')," +
      "((SELECT id FROM menus WHERE name='Cloud'), NULL, '阿里云', 'https://www.aliyun.com', 'https://img.alicdn.com/tfs/TB1_ZXuNcfpK1RjSZFOXXa6nFXa-32-32.ico', '阿里云官网')," +
      "((SELECT id FROM menus WHERE name='Cloud'), NULL, '腾讯云', 'https://cloud.tencent.com', '', '腾讯云官网')," +
      "((SELECT id FROM menus WHERE name='Cloud'), NULL, '甲骨文云', 'https://cloud.oracle.com', '', 'Oracle Cloud')," +
      "((SELECT id FROM menus WHERE name='Cloud'), NULL, '亚马逊云', 'https://aws.amazon.com', 'https://img.icons8.com/color/144/amazon-web-services.png', 'Amazon AWS')," +
      "((SELECT id FROM menus WHERE name='Cloud'), NULL, 'DigitalOcean', 'https://www.digitalocean.com', 'https://www.digitalocean.com/_next/static/media/apple-touch-icon.d7edaa01.png', 'DigitalOcean VPS')," +
      "((SELECT id FROM menus WHERE name='Cloud'), NULL, 'Vultr', 'https://www.vultr.com', '', 'Vultr VPS')," +
      "((SELECT id FROM menus WHERE name='Software'), NULL, 'Hellowindows', 'https://hellowindows.cn', 'https://hellowindows.cn/logo-s.png', 'windows系统及office下载')," +
      "((SELECT id FROM menus WHERE name='Software'), NULL, '奇迹秀', 'https://www.qijishow.com/down', 'https://www.qijishow.com/img/ico.ico', '设计师的百宝箱')," +
      "((SELECT id FROM menus WHERE name='Software'), NULL, '易破解', 'https://www.ypojie.com', 'https://www.ypojie.com/favicon.ico', '精品windows软件')," +
      "((SELECT id FROM menus WHERE name='Software'), NULL, '软件先锋', 'https://topcracked.com', 'https://cdn.mac89.com/win_macxf_node/static/favicon.ico', '精品windows软件')," +
      "((SELECT id FROM menus WHERE name='Software'), NULL, 'Macwk', 'https://www.macwk.com', 'https://www.macwk.com/favicon-32x32.ico', '精品Mac软件')," +
      "((SELECT id FROM menus WHERE name='Software'), NULL, 'Macsc', 'https://mac.macsc.com', 'https://cdn.mac89.com/macsc_node/static/favicon.ico', '')," +
      "((SELECT id FROM menus WHERE name='Tools'), NULL, 'JSON工具', 'https://www.json.cn', 'https://img.icons8.com/nolan/128/json.png', 'JSON格式化/校验')," +
      "((SELECT id FROM menus WHERE name='Tools'), NULL, 'base64工具', 'https://www.qqxiuzi.cn/bianma/base64.htm', 'https://cdn.base64decode.org/assets/images/b64-180.webp', '在线base64编码解码')," +
      "((SELECT id FROM menus WHERE name='Tools'), NULL, '二维码生成', 'https://cli.im', 'https://img.icons8.com/fluency/96/qr-code.png', '二维码生成工具')," +
      "((SELECT id FROM menus WHERE name='Tools'), NULL, 'JS混淆', 'https://obfuscator.io', 'https://img.icons8.com/color/240/javascript--v1.png', '在线Javascript代码混淆')," +
      "((SELECT id FROM menus WHERE name='Tools'), NULL, 'Python混淆', 'https://freecodingtools.org/tools/obfuscator/python', 'https://img.icons8.com/color/240/python--v1.png', '在线python代码混淆')," +
      "((SELECT id FROM menus WHERE name='Tools'), NULL, 'Remove.photos', 'https://remove.photos/zh-cn', 'https://img.icons8.com/doodle/192/picture.png', '一键抠图')," +
      "(NULL, (SELECT id FROM sub_menus WHERE name='Dev Tools'), 'Uiverse', 'https://uiverse.io/elements', 'https://img.icons8.com/fluency/96/web-design.png', 'CSS动画和设计元素')," +
      "(NULL, (SELECT id FROM sub_menus WHERE name='Dev Tools'), 'Icons8', 'https://igoutu.cn/icons', 'https://maxst.icons8.com/vue-static/landings/primary-landings/favs/icons8_fav_32×32.png', '免费图标和设计资源')," +
      "((SELECT id FROM menus WHERE name='Other'), NULL, 'Gmail', 'https://mail.google.com', 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico', 'Google邮箱')," +
      "((SELECT id FROM menus WHERE name='Other'), NULL, 'Outlook', 'https://outlook.live.com', 'https://img.icons8.com/color/256/ms-outlook.png', '微软Outlook邮箱')," +
      "((SELECT id FROM menus WHERE name='Other'), NULL, 'Proton Mail', 'https://account.proton.me', 'https://account.proton.me/assets/apple-touch-icon-120x120.png', '安全加密邮箱')," +
      "((SELECT id FROM menus WHERE name='Other'), NULL, 'QQ邮箱', 'https://mail.qq.com', 'https://mail.qq.com/zh_CN/htmledition/images/favicon/qqmail_favicon_96h.png', '腾讯QQ邮箱')," +
      "((SELECT id FROM menus WHERE name='Other'), NULL, '雅虎邮箱', 'https://mail.yahoo.com', 'https://img.icons8.com/color/240/yahoo--v2.png', '雅虎邮箱')," +
      "((SELECT id FROM menus WHERE name='Other'), NULL, '10分钟临时邮箱', 'https://linshiyouxiang.net', 'https://linshiyouxiang.net/static/index/zh/images/favicon.ico', '10分钟临时邮箱');",
    'INSERT INTO friends (title, url, logo) VALUES' +
      "('Noodseek图床', 'https://www.nodeimage.com', 'https://www.nodeseek.com/static/image/favicon/favicon-32x32.png')," +
      "('Font Awesome', 'https://fontawesome.com', 'https://fontawesome.com/favicon.ico');"
  ];
  for (const sql of statements) {
    await c.env.DB.prepare(sql).run();
  }
  return null;
}

app.use('/api/*', async (c, next) => {
  const seedRes = await ensureSeed(c);
  if (seedRes) return seedRes;
  await next();
});

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

export const onRequest = (c) => app.fetch(c.request, c.env, c.executionCtx);
