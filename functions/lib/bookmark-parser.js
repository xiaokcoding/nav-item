/**
 * Bookmark HTML Parser
 * 解析 Netscape Bookmark File Format (Chrome/Firefox 导出的书签 HTML)
 */
import { parse } from 'node-html-parser';

// 最大文件大小 5MB
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * 清理字符串，防止 XSS
 * @param {string} str
 * @returns {string}
 */
export function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim()
    .slice(0, 500); // 限制长度
}

/**
 * 清理 URL
 * @param {string} url
 * @returns {string}
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  // 只允许 http/https 协议
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return '';
  }
  return trimmed.slice(0, 2048); // 限制 URL 长度
}

/**
 * 解析书签 HTML，返回结构化数据
 * @param {string} html
 * @returns {{ menus: Array, errors: Array }}
 */
export function parseBookmarkHtml(html) {
  const errors = [];
  const menus = [];

  try {
    const root = parse(html, {
      lowerCaseTagName: true,
      comment: false,
      blockTextElements: {
        script: false,
        noscript: false,
        style: false,
      }
    });

    // 查找所有 DL 元素（书签列表容器）
    const topDl = root.querySelector('dl');
    if (!topDl) {
      errors.push('未找到有效的书签结构 (缺少 DL 元素)');
      return { menus, errors };
    }

    // 解析顶层 DL 下的内容
    parseTopLevelBookmarks(topDl, menus, errors);

  } catch (e) {
    errors.push(`解析错误: ${e.message}`);
  }

  return { menus, errors };
}

const ROOT_FOLDER_NAMES = new Set([
  '书签栏',
  '其他书签',
  '书签菜单',
  '移动书签',
  'bookmarks bar',
  'bookmarks toolbar',
  'other bookmarks',
  'mobile bookmarks',
  'bookmarks menu'
]);

/**
 * 解析顶层 DL（跳过浏览器默认根目录）
 * @param {HTMLElement} dlElement
 * @param {Array} targetArray
 * @param {Array} errors
 */
function parseTopLevelBookmarks(dlElement, targetArray, errors) {
  if (!dlElement) return;

  const children = dlElement.childNodes;
  const topLevelOrder = { value: 0 };
  let skippedRootFolder = false;

  for (const child of children) {
    if (child.nodeType !== 1) continue;

    const tagName = child.tagName?.toLowerCase();
    if (tagName !== 'dt') continue;

    const h3 = child.querySelector('h3');
    const nestedDl = child.querySelector('dl');

    if (h3) {
      const folderName = (h3.text || h3.textContent || '').trim();
      const isRootFolder = isRootContainerFolder(h3, folderName);

      if (isRootFolder) {
        skippedRootFolder = true;
        if (nestedDl) {
          parseBookmarkLevel(nestedDl, targetArray, null, errors, 0, topLevelOrder);
        }
        continue;
      }
    }

    parseBookmarkLevel(child, targetArray, null, errors, 0, topLevelOrder);
  }

  if (skippedRootFolder) {
    errors.push('已自动跳过浏览器默认根目录，以匹配常见导出结构');
  }
}

/**
 * 判断是否为浏览器默认根目录
 * @param {HTMLElement} h3Element
 * @param {string} folderName
 * @returns {boolean}
 */
function isRootContainerFolder(h3Element, folderName) {
  if (!folderName) return false;
  const normalized = folderName.trim().toLowerCase();
  const isToolbar = (h3Element.getAttribute('personal_toolbar_folder') || '').toLowerCase() === 'true';
  return isToolbar || ROOT_FOLDER_NAMES.has(normalized);
}

/**
 * 递归解析书签层级
 * @param {HTMLElement} dlElement DL 元素
 * @param {Array} targetArray 目标数组
 * @param {object|null} parentMenu 父菜单
 * @param {Array} errors 错误数组
 * @param {number} depth 当前深度
 * @param {{ value: number } | null} orderState 当前层级的排序状态
 */
function parseBookmarkLevel(dlElement, targetArray, parentMenu, errors, depth, orderState = null) {
  if (!dlElement) return;

  const elementTag = dlElement.tagName?.toLowerCase();
  const children = elementTag === 'dt' ? [dlElement] : dlElement.childNodes;
  const orderRef = orderState || { value: 0 };

  for (const child of children) {
    if (child.nodeType !== 1) continue; // 只处理元素节点

    const tagName = child.tagName?.toLowerCase();
    if (tagName !== 'dt') continue;

    // 查找 DT 下的 H3 (文件夹) 或 A (书签)
    const h3 = child.querySelector('h3');
    const a = child.querySelector('a');
    const nestedDl = child.querySelector('dl');

    if (h3) {
      // 这是一个文件夹
      const folderName = sanitizeString(h3.text || h3.textContent || '');

      if (!folderName) {
        errors.push('发现空名称的文件夹，已跳过');
        continue;
      }

      if (depth === 0) {
        // 顶层文件夹 -> menu
        const menu = {
          type: 'menu',
          name: folderName,
          order: orderRef.value++,
          subMenus: [],
          cards: []
        };
        targetArray.push(menu);

        // 递归解析子内容
        if (nestedDl) {
          parseBookmarkLevel(nestedDl, menu.subMenus, menu, errors, depth + 1);
        }
      } else if (depth === 1 && parentMenu) {
        // 二级文件夹 -> sub_menu
        const subMenu = {
          type: 'subMenu',
          name: folderName,
          order: orderRef.value++,
          cards: []
        };
        parentMenu.subMenus.push(subMenu);

        // 递归解析书签（三级及以下文件夹内的书签都归入此 sub_menu）
        if (nestedDl) {
          parseBookmarkLevel(nestedDl, subMenu.cards, subMenu, errors, depth + 1);
        }
      } else {
        // 更深层级的文件夹，将其内容扁平化到当前层级
        if (nestedDl) {
          parseBookmarkLevel(nestedDl, targetArray, parentMenu, errors, depth);
        }
      }
    } else if (a) {
      // 这是一个书签
      const url = sanitizeUrl(a.getAttribute('href') || '');
      const title = sanitizeString(a.text || a.textContent || '');

      if (!url) {
        if (title) {
          errors.push(`书签 "${title}" 的 URL 无效，已跳过`);
        }
        continue;
      }

      const card = {
        type: 'card',
        title: title || url,
        url: url,
        desc: '',
        order: orderRef.value++
      };

      // 根据深度决定添加位置
      if (depth === 0) {
        // 顶层书签，需要创建默认 menu
        // 这种情况较少见，暂时收集到 errors 提示
        errors.push(`顶层书签 "${title}" 需要放入默认栏目`);
        // 创建一个特殊标记
        targetArray.push({
          ...card,
          type: 'topLevelCard'
        });
      } else if (depth === 1 && parentMenu) {
        // menu 下的直接书签（没有 sub_menu）
        parentMenu.cards.push(card);
      } else {
        // sub_menu 或更深层级下的书签
        targetArray.push(card);
      }
    }
  }
}

/**
 * 将解析结果转换为扁平化的导入数据
 * @param {Array} menus 解析后的菜单结构
 * @returns {{ menuList: Array, subMenuList: Array, cardList: Array }}
 */
export function flattenParsedData(menus) {
  const menuList = [];
  const subMenuList = [];
  const cardList = [];
  const topLevelCards = [];

  for (const menu of menus) {
    if (menu.type === 'topLevelCard') {
      topLevelCards.push(menu);
      continue;
    }

    if (menu.type !== 'menu') continue;

    const menuData = {
      name: menu.name,
      order: menu.order,
      _tempId: `menu_${menuList.length}`
    };
    menuList.push(menuData);

    // 处理 menu 下的直接 cards
    for (const card of menu.cards || []) {
      cardList.push({
        ...card,
        _menuTempId: menuData._tempId,
        _subMenuTempId: null
      });
    }

    // 处理 sub_menus
    for (const subMenu of menu.subMenus || []) {
      if (subMenu.type === 'card') {
        // 这是 menu 下的直接 card
        cardList.push({
          ...subMenu,
          _menuTempId: menuData._tempId,
          _subMenuTempId: null
        });
      } else if (subMenu.type === 'subMenu') {
        const subMenuData = {
          name: subMenu.name,
          order: subMenu.order,
          _tempId: `submenu_${subMenuList.length}`,
          _menuTempId: menuData._tempId
        };
        subMenuList.push(subMenuData);

        // 处理 sub_menu 下的 cards
        for (const card of subMenu.cards || []) {
          if (card.type === 'card') {
            cardList.push({
              ...card,
              _menuTempId: menuData._tempId,
              _subMenuTempId: subMenuData._tempId
            });
          }
        }
      }
    }
  }

  // 处理顶层书签 - 添加到默认栏目
  if (topLevelCards.length > 0) {
    const defaultMenu = {
      name: '导入书签',
      order: menuList.length,
      _tempId: `menu_default`
    };
    menuList.push(defaultMenu);

    for (const card of topLevelCards) {
      cardList.push({
        title: card.title,
        url: card.url,
        desc: card.desc || '',
        order: card.order,
        _menuTempId: defaultMenu._tempId,
        _subMenuTempId: null
      });
    }
  }

  return { menuList, subMenuList, cardList };
}
