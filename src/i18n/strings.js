import { getLang, LANG_EN } from './lang.js';

// 界面文案目录：所有面向用户的界面字符串都收在这里，按稳定 id 分组。
// 规则：中文严格保持改造前的原句；英文按同等信息量重写（不逐字直译）。
// 语言切换器的选项名随当前界面语言本地化（英文界面显示 English / Chinese），
// 这样英文界面里不会出现任何中文字符。
const STRINGS = {
  // 欢迎页
  'welcome.aria': { zh: '欢迎', en: 'Welcome' },
  'welcome.kicker': { zh: '艺术与观念 · Arts and Ideas', en: 'Arts and Ideas' },
  'welcome.title': { zh: '时光画廊', en: 'Time Gallery' },
  'welcome.subtitle': {
    zh: '从洞穴壁画到现代主义，步入十二个时代的图像现场',
    en: 'From cave painting to modernism: step into twelve eras of images',
  },
  'welcome.start': { zh: '进入时间轴', en: 'Enter the Timeline' },

  // 时间轴
  'timeline.aria': { zh: '时间轴', en: 'Timeline' },
  'timeline.kicker': { zh: '树状时间轴', en: 'Timeline Tree' },
  'timeline.title': { zh: '十二个时代的图像现场', en: 'Twelve Eras of Images' },
  'timeline.hint': {
    zh: '悬停查看代表画作，点击节点进入该时期画廊',
    en: 'Hover a node for representative works, click to enter that period gallery',
  },
  'timeline.unknownArtist': { zh: '佚名', en: 'Unknown artist' },
  'timeline.enterPeriod': { zh: '进入{period}画廊', en: 'Enter the {period} gallery' },
  'timeline.artworkCount': { zh: '{count} 幅画作', en: '{count} works' },

  // 画作详情
  'detail.aria': { zh: '画作详情', en: 'Artwork Details' },
  'detail.close': { zh: '关闭详情', en: 'Close details' },
  'detail.unknownLifetime': { zh: '年代久远，作者佚名', en: 'Ancient work, artist unknown' },
  'detail.unknownYear': { zh: '？', en: '?' },
  'detail.artist': { zh: '画家', en: 'Artist' },
  'detail.unknownArtist': { zh: '佚名', en: 'Unknown artist' },
  'detail.lifespan': { zh: '生卒', en: 'Dates' },
  'detail.year': { zh: '年代', en: 'Date' },
  'detail.period': { zh: '时期', en: 'Period' },
  'detail.source': { zh: '来源', en: 'Source' },
  'detail.license': { zh: '授权', en: 'License' },
  'detail.localAsset': { zh: '本地资产', en: 'Local asset' },
  'detail.publicDomain': { zh: '公有领域', en: 'Public domain' },

  // 3D 展厅
  'gallery.aria': { zh: '画廊展厅', en: 'Gallery room' },
  'gallery.back': { zh: '返回时间轴', en: 'Back to Timeline' },
  'gallery.hintTouch': {
    zh: '拖动旋转视角 · 点击画作查看详情',
    en: 'Drag to look around · Tap a painting for details',
  },
  'gallery.hintDesktop': {
    zh: 'WASD / 方向键移动 · 鼠标旋转 · E 查看 · Esc 退出',
    en: 'WASD / arrow keys to move · Mouse to look · E for details · Esc to exit',
  },
  'gallery.pointerHintTitle': { zh: '点击画面进入第一人称', en: 'Click the scene for first-person view' },
  'gallery.pointerHintKeys': { zh: 'A / ← 向左 · D / → 向右', en: 'A / ← left · D / → right' },
  'gallery.unknownArtist': { zh: '佚名', en: 'Unknown artist' },
  'gallery.joystickCaption': { zh: '按住摇杆移动', en: 'Hold the stick to move' },

  // 语言切换器
  'lang.label': { zh: '语言', en: 'Language' },
  'lang.optionEn': { zh: '英文', en: 'English' },
  'lang.optionZh': { zh: '中文', en: 'Chinese' },
  'lang.selectEn': { zh: '切换到英文', en: 'Switch to English' },
  'lang.selectZh': { zh: '切换到中文', en: 'Switch to Chinese' },

  // 文档元信息（index.html 静态值同此，运行时按语言改写）
  'doc.title': { zh: '时光画廊', en: 'Time Gallery' },
  'doc.description': {
    zh: '时光画廊：以第一人称 3D 展厅浏览十二个艺术时期与九十六幅公有领域经典画作。',
    en: 'Time Gallery: browse twelve art periods and ninety-six public-domain masterworks in a first-person 3D exhibition.',
  },
};

// 取词：{name} 形式的占位符由 vars 替换；缺键时回显 key，便于开发期暴露遗漏。
export function t(key, vars) {
  const entry = STRINGS[key];
  const lang = getLang();
  let text;
  if (!entry) {
    text = key;
  } else {
    text = lang === LANG_EN ? entry.en : entry.zh;
    if (!text) text = entry.en || entry.zh || key;
  }
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
