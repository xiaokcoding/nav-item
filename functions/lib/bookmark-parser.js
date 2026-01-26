/**
 * Bookmark HTML Parser
 * 解析 Netscape Bookmark File Format (Chrome/Firefox 导出的书签 HTML)
 * 
 * 输出结构保留完整文件夹路径信息，支持：
 * - 自动创建模式：根文件夹 => 菜单，子文件夹路径 => 分组名（多级用 " / " 拼接）
 * - 指定栏目模式：所有书签导入到指定菜单，分组按完整路径创建
 */
import { parse } from 'node-html-parser';

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
 * 解析书签 HTML，返回带路径信息的扁平化书签列表
 * @param {string} html
 * @returns {{ bookmarks: Array<{title, url, rootFolder, folderPath}>, rootFolders: string[], errors: string[] }}
 * 
 * bookmarks 中每个书签包含:
 * - title: 书签标题
 * - url: 书签 URL
 * - rootFolder: 根文件夹名（如 "书签栏"），null 表示根级散书签
 * - folderPath: 子文件夹路径数组（不含根文件夹），如 ["开发", "前端"]
 * - order: 在同级的原始顺序
 */
export function parseBookmarkHtml(html) {
  const errors = [];
  const bookmarks = [];
  const rootFolderSet = new Set();
  let globalOrder = 0;

  try {
    const root = parse(html, {
      lowerCaseTagName: true,
      comment: false,
      blockTextElements: { script: false, noscript: false, style: false }
    });

    const topDl = root.querySelector('dl');
    if (!topDl) {
      errors.push('未找到有效的书签结构 (缺少 DL 元素)');
      return { bookmarks, rootFolders: [], errors };
    }

    /**
     * 从DT元素中获取A标签
     */
    function getAFromDt(dt) {
      if (!dt || !dt.childNodes) return null;
      for (const child of dt.childNodes) {
        if (child.nodeType === 1 && child.tagName?.toLowerCase() === 'a') {
          return child;
        }
      }
      return null;
    }

    /**
     * 扁平化解析书签
     * node-html-parser 把所有元素扁平化到同一个 DL 下
     * 所以用顺序来判断书签归属：遇到 H3 就切换当前文件夹，后续 DT 都属于这个文件夹
     */
    let currentFolder = null;  // 当前文件夹名
    let skipUntilNextH3 = false;  // 是否跳过直到下一个H3（用于跳过书签栏标题本身）

    const children = topDl.childNodes;
    for (const child of children) {
      if (child.nodeType !== 1) continue;
      const tagName = child.tagName?.toLowerCase();

      if (tagName === 'h3') {
        const folderName = sanitizeString(child.text || child.textContent || '');
        if (!folderName) {
          errors.push('发现空名称的文件夹，已跳过');
          continue;
        }

        // 检查是否为书签栏
        const isToolbarFolder = child.getAttribute('personal_toolbar_folder') === 'true';
        
        if (isToolbarFolder) {
          // 书签栏不作为根目录，跳过这个 H3，但继续处理后面的内容
          // 后续的 H3 会成为真正的根文件夹
          skipUntilNextH3 = false;  // 重置，继续处理后面内容
          currentFolder = null;  // 书签栏下的直接书签没有文件夹
        } else {
          // 普通文件夹，成为当前文件夹
          currentFolder = folderName;
          rootFolderSet.add(folderName);
          skipUntilNextH3 = false;
        }
      } else if (tagName === 'dt' && !skipUntilNextH3) {
        // 检查 DT 内是否有 A 标签（书签）
        const a = getAFromDt(child);
        if (a) {
          const url = sanitizeUrl(a.getAttribute('href') || '');
          const title = sanitizeString(a.text || a.textContent || '');

          if (!url) {
            if (title) errors.push(`书签 "${title}" 的 URL 无效，已跳过`);
            continue;
          }

          bookmarks.push({
            title: title || url,
            url,
            rootFolder: currentFolder,
            folderPath: [],  // 扁平化后没有子文件夹路径
            order: globalOrder++
          });
        }
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
    // 3. 根级散书签 => "导入书签" 菜单的默认分组

    for (const bm of bookmarks) {
      if (bm.rootFolder === null) {
        // 根级散书签 => "导入书签" 菜单
        const menuKey = ensureMenu('导入书签');
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
