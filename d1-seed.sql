INSERT INTO menus (id, name, "order") VALUES
  (1, 'Home', 1),
  (2, 'Ai Stuff', 2)
ON CONFLICT(id) DO NOTHING;

INSERT INTO sub_menus (id, parent_id, name, "order") VALUES
  (1, 2, 'AI chat', 1),
  (2, 2, 'AI tools', 2)
ON CONFLICT(id) DO NOTHING;

INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, desc, "order") VALUES
  (1, NULL, 'GitHub', 'https://github.com', '', '代码托管', 1),
  (1, NULL, 'Google', 'https://www.google.com', '', '搜索', 2),
  (2, NULL, 'ChatGPT', 'https://chat.openai.com', '', 'AI 对话', 1)
ON CONFLICT DO NOTHING;

INSERT INTO ads (id, position, img, url) VALUES
  (1, 'left', 'https://placehold.co/160x600', 'https://example.com')
ON CONFLICT(id) DO NOTHING;

INSERT INTO friends (id, title, url, logo) VALUES
  (1, 'Font Awesome', 'https://fontawesome.com', 'https://fontawesome.com/favicon.ico')
ON CONFLICT(id) DO NOTHING;