/**
 * Bookmark HTML Parser
 * 解析 Netscape Bookmark File Format (Chrome/Firefox 导出的书签 HTML)
 * 
 * 使用正则表达式解析，因为 node-html-parser 会将嵌套的 DL 结构扁平化
 */

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * 清理字符串
 */
export function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().slice(0, 500);
}

/**
 * 清理 URL
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return '';
  }
  return trimmed.slice(0, 2048);
}

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * 解析书签 HTML，返回带路径信息的扁平化书签列表
 * 使用正则表达式按顺序解析 HTML 标签
 */
export function parseBookmarkHtml(html) {
  const errors = [];
  const bookmarks = [];
  const rootFolderSet = new Set();
  let globalOrder = 0;

  try {
    // 用正则匹配所有关键标签
    // 匹配: <DL>, </DL>, <DT><H3 ...>文件夹名</H3>, <DT><A ...>书签名</A>
    const tagPattern = /<DL>|<\/DL>|<DT><H3([^>]*)>([^<]*)<\/H3>|<DT><A([^>]*)>([^<]*)<\/A>/gi;

    // 文件夹栈：每个元素是 { name, isToolbar }
    const folderStack = [];
    let insideToolbar = false;  // 是否在书签栏内部

    let match;
    while ((match = tagPattern.exec(html)) !== null) {
      const fullMatch = match[0].toUpperCase();

      if (fullMatch === '<DL>') {
        // 进入新的 DL 层级（不做特殊处理，文件夹栈已在 H3 时处理）
        continue;
      }

      if (fullMatch === '</DL>') {
        // 离开 DL 层级，弹出文件夹栈
        if (folderStack.length > 0) {
          const popped = folderStack.pop();
          // 如果弹出的是书签栏，重置标记
          if (popped.isToolbar) {
            insideToolbar = false;
          }
        }
        continue;
      }

      // H3 标签 - 文件夹
      if (match[1] !== undefined) {
        const attrs = match[1];
        const folderName = sanitizeString(decodeHtmlEntities(match[2]));

        if (!folderName) {
          errors.push('发现空名称的文件夹，已跳过');
          continue;
        }

        // 检查是否为书签栏
        const isToolbar = /PERSONAL_TOOLBAR_FOLDER\s*=\s*["']?true["']?/i.test(attrs);

        if (isToolbar) {
          // 书签栏：标记进入书签栏，但不加入路径
          folderStack.push({ name: folderName, isToolbar: true });
          insideToolbar = true;
        } else {
          // 普通文件夹
          folderStack.push({ name: folderName, isToolbar: false });

          // 如果在书签栏内且这是第一层文件夹，它就是根文件夹
          if (insideToolbar) {
            // 计算当前有效路径（排除书签栏本身）
            const effectiveDepth = folderStack.filter(f => !f.isToolbar).length;
            if (effectiveDepth === 1) {
              rootFolderSet.add(folderName);
            }
          }
        }
        continue;
      }

      // A 标签 - 书签
      if (match[3] !== undefined) {
        const attrs = match[3];
        const title = sanitizeString(decodeHtmlEntities(match[4]));

        // 提取 href
        const hrefMatch = /HREF\s*=\s*["']([^"']*)["']/i.exec(attrs);
        const url = hrefMatch ? sanitizeUrl(hrefMatch[1]) : '';

        if (!url) {
          if (title) errors.push(`书签 "${title}" 的 URL 无效，已跳过`);
          continue;
        }

        // 计算当前书签的文件夹路径（排除书签栏）
        const effectiveFolders = folderStack.filter(f => !f.isToolbar).map(f => f.name);

        let rootFolder = null;
        let folderPath = [];

        if (effectiveFolders.length > 0) {
          rootFolder = effectiveFolders[0];
          folderPath = effectiveFolders.slice(1);
        }

        bookmarks.push({
          title: title || url,
          url,
          rootFolder,
          folderPath,
          order: globalOrder++
        });
      }
    }

  } catch (e) {
    errors.push(`解析错误: ${e.message}`);
  }

  return {
    bookmarks,
    rootFolders: Array.from(rootFolderSet),
    errors
  };
}

/**
 * 根据目标模式生成导入计划
 * @param {object} params
 * @param {Array} params.bookmarks - 解析后的书签列表
 * @param {string[]} params.rootFolders - 所有根文件夹名
 * @param {'auto'|'menu'} params.targetType - 目标类型
 * @param {number|null} params.targetMenuId - 指定栏目时的菜单 ID
 * @param {string|null} params.targetMenuName - 指定栏目时的菜单名称
 * @param {Map<string, number>} params.existingMenus - 已存在的菜单 name => id
 * @param {Map<string, Map<string, number>>} params.existingGroups - 已存在的分组 menuId => (groupName => id)
 * @param {Map<string, Set<string>>} params.existingUrls - 已存在的 URL (menuId-groupId|null) => Set<url>
 * @returns {object} plan
 */
export function generateImportPlan({
  bookmarks,
  rootFolders,
  targetType,
  targetMenuId,
  targetMenuName,
  existingMenus,
  existingGroups,
  existingUrls
}) {
  const plan = {
    // 菜单计划: { name, action: 'create'|'reuse', existingId?, order }
    menus: [],
    // 分组计划: { menuKey, name, action: 'create'|'reuse', existingId?, order }
    groups: [],
    // 书签计划: { menuKey, groupKey, title, url, action: 'create'|'skip', order }
    cards: [],
    // 统计
    stats: {
      menusToCreate: 0,
      menusToReuse: 0,
      groupsToCreate: 0,
      groupsToReuse: 0,
      cardsToCreate: 0,
      cardsToSkip: 0
    }
  };

  // 临时映射
  const menuKeyMap = new Map(); // menuKey => plan.menus index
  const groupKeyMap = new Map(); // groupKey => plan.groups index
  const urlTracker = new Map(); // (menuKey-groupKey) => Set<url> 用于批次内去重

  let menuOrder = 0;
  const groupOrderMap = new Map(); // menuKey => current order
  const cardOrderMap = new Map(); // groupKey => current order

  /**
   * 获取或创建菜单计划
   */
  function ensureMenu(menuName) {
    const menuKey = `menu:${menuName}`;
    if (menuKeyMap.has(menuKey)) {
      return menuKey;
    }

    const existingId = existingMenus.get(menuName);
    const menuPlan = {
      key: menuKey,
      name: menuName,
      action: existingId ? 'reuse' : 'create',
      existingId: existingId || null,
      order: menuOrder++
    };
    plan.menus.push(menuPlan);
    menuKeyMap.set(menuKey, plan.menus.length - 1);

    if (existingId) {
      plan.stats.menusToReuse++;
    } else {
      plan.stats.menusToCreate++;
    }

    groupOrderMap.set(menuKey, 0);
    return menuKey;
  }

  /**
   * 获取或创建分组计划
   * @param {string} menuKey
   * @param {string} groupName - 分组名（如 "开发 / 前端"）
   */
  function ensureGroup(menuKey, groupName) {
    const groupKey = `${menuKey}||group:${groupName}`;
    if (groupKeyMap.has(groupKey)) {
      return groupKey;
    }

    // 查找已存在的分组
    const menuPlan = plan.menus[menuKeyMap.get(menuKey)];
    const menuId = menuPlan.existingId;
    let existingId = null;
    if (menuId && existingGroups.has(String(menuId))) {
      existingId = existingGroups.get(String(menuId)).get(groupName) || null;
    }

    const groupPlan = {
      key: groupKey,
      menuKey,
      name: groupName,
      action: existingId ? 'reuse' : 'create',
      existingId: existingId || null,
      order: groupOrderMap.get(menuKey) || 0
    };
    groupOrderMap.set(menuKey, (groupOrderMap.get(menuKey) || 0) + 1);

    plan.groups.push(groupPlan);
    groupKeyMap.set(groupKey, plan.groups.length - 1);

    if (existingId) {
      plan.stats.groupsToReuse++;
    } else {
      plan.stats.groupsToCreate++;
    }

    cardOrderMap.set(groupKey, 0);
    return groupKey;
  }

  /**
   * 添加书签到计划
   */
  function addCard(menuKey, groupKey, title, url) {
    // 批次内去重
    const trackKey = `${menuKey}||${groupKey || 'null'}`;
    if (!urlTracker.has(trackKey)) {
      urlTracker.set(trackKey, new Set());
    }
    if (urlTracker.get(trackKey).has(url)) {
      plan.stats.cardsToSkip++;
      return;
    }

    // 数据库已存在检查
    const menuPlan = plan.menus[menuKeyMap.get(menuKey)];
    const menuId = menuPlan.existingId;
    let groupId = null;
    if (groupKey) {
      const groupPlan = plan.groups[groupKeyMap.get(groupKey)];
      groupId = groupPlan.existingId;
    }

    const urlSetKey = `${menuId || 'new'}-${groupId || 'null'}`;
    const existingUrlSet = existingUrls.get(urlSetKey);
    if (existingUrlSet && existingUrlSet.has(url)) {
      plan.cards.push({
        menuKey,
        groupKey,
        title,
        url,
        action: 'skip',
        order: cardOrderMap.get(groupKey || menuKey) || 0
      });
      plan.stats.cardsToSkip++;
    } else {
      plan.cards.push({
        menuKey,
        groupKey,
        title,
        url,
        action: 'create',
        order: cardOrderMap.get(groupKey || menuKey) || 0
      });
      plan.stats.cardsToCreate++;
    }

    cardOrderMap.set(groupKey || menuKey, (cardOrderMap.get(groupKey || menuKey) || 0) + 1);
    urlTracker.get(trackKey).add(url);
  }

  // ========== 处理书签 ==========

  if (targetType === 'auto') {
    // 自动创建模式
    // 1. 根文件夹 => 菜单
    // 2. 子文件夹路径 => 分组（用 " / " 拼接）
    // 3. 根级散书签 => "Home" 菜单的默认分组

    for (const bm of bookmarks) {
      if (bm.rootFolder === null) {
        // 根级散书签 => "Home" 菜单
        const menuKey = ensureMenu('Home');
        addCard(menuKey, null, bm.title, bm.url);
      } else {
        // 有根文件夹
        const menuKey = ensureMenu(bm.rootFolder);

        if (bm.folderPath.length === 0) {
          // 直接在根文件夹下，无分组
          addCard(menuKey, null, bm.title, bm.url);
        } else {
          // 有子文件夹路径 => 创建分组
          const groupName = bm.folderPath.join(' / ');
          const groupKey = ensureGroup(menuKey, groupName);
          addCard(menuKey, groupKey, bm.title, bm.url);
        }
      }
    }
  } else {
    // 指定栏目模式
    // 所有书签导入到 targetMenuId
    // 分组按完整路径创建（包含根文件夹名作为路径首段）

    const menuKey = `menu:${targetMenuName}`;
    const menuPlan = {
      key: menuKey,
      name: targetMenuName,
      action: 'reuse',
      existingId: targetMenuId,
      order: 0
    };
    plan.menus.push(menuPlan);
    menuKeyMap.set(menuKey, 0);
    plan.stats.menusToReuse++;
    groupOrderMap.set(menuKey, 0);

    for (const bm of bookmarks) {
      if (bm.rootFolder === null && bm.folderPath.length === 0) {
        // 根级散书签 => 默认分组（无分组）
        addCard(menuKey, null, bm.title, bm.url);
      } else {
        // 构建完整路径（根文件夹 + 子路径）
        const fullPath = bm.rootFolder
          ? [bm.rootFolder, ...bm.folderPath]
          : bm.folderPath;

        if (fullPath.length === 0) {
          addCard(menuKey, null, bm.title, bm.url);
        } else {
          const groupName = fullPath.join(' / ');
          const groupKey = ensureGroup(menuKey, groupName);
          addCard(menuKey, groupKey, bm.title, bm.url);
        }
      }
    }
  }

  return plan;
}
