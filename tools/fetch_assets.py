# -*- coding: utf-8 -*-
"""Build local art assets and manifest from Wikimedia Commons.

This script is used only during development. The delivered app never calls
the network: every image is copied under public/assets/art and the manifest
records the Commons source page, author, date and license.
"""

import json
import html
import os
import re
import sys
import time
import urllib.parse
import urllib.request


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "public", "assets", "art")
API = "https://commons.wikimedia.org/w/api.php"
UA = "TimeGalleryBuild/1.0 (offline-public-domain-assets)"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


PERIODS = [
    {
        "id": "ancient-medieval",
        "name": "古代与中世纪",
        "range": "约公元前15000-1450年",
        "description": "从洞穴图像、爱琴海与罗马壁画到拜占庭镶嵌和哥特手抄本，艺术首先服务于宇宙观、宗教权威与共同体记忆。"
    },
    {
        "id": "early-renaissance",
        "name": "文艺复兴早期",
        "range": "约1300-1500年",
        "description": "透视、自然观察与人文主义共同出现，绘画从圣像转向可测量的世界，也重新界定人在宇宙中的位置。"
    },
    {
        "id": "high-renaissance",
        "name": "文艺复兴盛期",
        "range": "约1500-1530年",
        "description": "达·芬奇、拉斐尔与米开朗琪罗把理想人体、古典秩序和科学观察熔铸为高度综合的宏大图景。"
    },
    {
        "id": "baroque",
        "name": "巴洛克",
        "range": "约1600-1720年",
        "description": "宗教改革与反宗教改革重塑图像功能，戏剧性光线、动态构图和感官强度成为说服与沉浸的新语言。"
    },
    {
        "id": "rococo-neoclassicism",
        "name": "洛可可与新古典",
        "range": "约1720-1810年",
        "description": "宫廷趣味转向精致逸乐，随后启蒙运动把艺术重新引向公民德性、古代共和与理性的宏大叙事。"
    },
    {
        "id": "romanticism",
        "name": "浪漫主义",
        "range": "约1790-1850年",
        "description": "工业革命与革命年代让个体情感、历史创伤、自然崇高与民族想象成为绘画的中心。"
    },
    {
        "id": "realism",
        "name": "写实主义",
        "range": "约1848-1870年",
        "description": "库尔贝与巴比松画家拒绝理想化，把劳动、城市生活和现代经验直接搬上画布，艺术开始成为社会观察。"
    },
    {
        "id": "impressionism",
        "name": "印象派",
        "range": "约1860-1890年",
        "description": "光色科学、铁路与休闲城市生活改变了观看方式，画家记录瞬间氛围，把画布变成光的现场。"
    },
    {
        "id": "post-impressionism",
        "name": "后印象派与象征主义",
        "range": "约1880-1910年",
        "description": "塞尚、梵高、高更与修拉从印象派出发，分别走向结构、情感、象征和科学秩序，预示现代艺术的独立。"
    },
    {
        "id": "modern-avant-garde",
        "name": "现代主义先锋",
        "range": "约1900-1930年",
        "description": "野兽派、表现主义、抽象与至上主义宣告形式自治：颜色、线条和构图不再模仿世界，而是创造世界。"
    },
    {
        "id": "expressionism-beyond",
        "name": "表现主义与未来主义",
        "range": "约1905-1940年",
        "description": "战争、都市、机器与精神焦虑推动绘画走向变形与暴力色彩，巴黎画派则以线条和色彩重新定义现代人体。"
    },
    {
        "id": "american-modern",
        "name": "美国现代主义与20世纪之路",
        "range": "约1910-1945年",
        "description": "美国艺术家以精确主义、乡土写实和抽象构成回应工业景观，战后的抽象表现主义与波普艺术继续接续这些现代实验。"
    },
]


WORKS = [
    {
        "id": "a01", "file": "Lascaux painting.jpg", "periodId": "ancient-medieval",
        "titleZh": "拉斯科洞穴野牛", "titleEn": "Lascaux Cave Painting",
        "artistId": "anonymous", "artistNameZh": "佚名", "artistNameEn": "Anonymous",
        "artistBorn": None, "artistDied": None, "nationality": "多地区",
        "year": "约公元前15000-13000",
        "description": "岩壁上的野牛与符号共同构成最早的图像仪式，艺术在此刻已具备记忆、狩猎巫术与集体认同的多重功能。"
    },
    {
        "id": "a02", "file": "Fresco of a fisherman, Akrotiri, Greece.jpg", "periodId": "ancient-medieval",
        "titleZh": "渔夫壁画", "titleEn": "Fisherman Fresco from Akrotiri",
        "artistId": "anonymous", "artistNameZh": "佚名", "artistNameEn": "Anonymous",
        "artistBorn": None, "artistDied": None, "nationality": "米诺斯文明",
        "year": "约公元前1600",
        "description": "爱琴海宫殿壁画以流畅线条与明亮色块记录海洋生活，展现出青铜时代贸易社会对自然与身体的从容凝视。"
    },
    {
        "id": "a03", "file": "Fresque des mytères, Pompéi.jpg", "periodId": "ancient-medieval",
        "titleZh": "秘仪别墅壁画", "titleEn": "Frescoes from the Villa of the Mysteries",
        "artistId": "anonymous", "artistNameZh": "佚名", "artistNameEn": "Anonymous",
        "artistBorn": None, "artistDied": None, "nationality": "罗马",
        "year": "约公元前60-50",
        "description": "庞贝别墅的连续壁画把酒神秘仪演成剧场式图像，展示罗马私人宅邸如何以绘画制造氛围、身份与神圣经验。"
    },
    {
        "id": "a04", "file": "Meister von San Vitale in Ravenna 001.jpg", "periodId": "ancient-medieval",
        "titleZh": "查士丁尼皇帝与随从", "titleEn": "Emperor Justinian and His Attendants",
        "artistId": "anonymous", "artistNameZh": "佚名", "artistNameEn": "Anonymous",
        "artistBorn": None, "artistDied": None, "nationality": "拜占庭",
        "year": "约547",
        "description": "拉文纳圣维塔莱镶嵌画以金底与平面化人物将皇帝和教会并置，图像成为拜占庭神权秩序的视觉宣言。"
    },
    {
        "id": "a05", "file": "Meister von San Vitale in Ravenna 002.jpg", "periodId": "ancient-medieval",
        "titleZh": "狄奥多拉皇后与随从", "titleEn": "Empress Theodora and Her Attendants",
        "artistId": "anonymous", "artistNameZh": "佚名", "artistNameEn": "Anonymous",
        "artistBorn": None, "artistDied": None, "nationality": "拜占庭",
        "year": "约547",
        "description": "狄奥多拉皇后身披紫袍、手执圣杯，镶嵌画以永恒金色把世俗权力纳入神圣秩序，塑造女性统治者的公共形象。"
    },
    {
        "id": "a06", "file": "Les Très Riches Heures du duc de Berry octobre.jpg", "periodId": "ancient-medieval",
        "titleZh": "十月：播种与卢浮宫", "titleEn": "October from Les Très Riches Heures du Duc de Berry",
        "artistId": "limbourg", "artistNameZh": "林堡兄弟", "artistNameEn": "Limbourg Brothers",
        "artistBorn": None, "artistDied": 1416, "nationality": "法兰德斯",
        "year": "约1410-1416",
        "description": "《贝里公爵豪华时祷书》把农事、贵族城堡与月历并置，哥特末期的自然观察和细密叙事在此交汇。"
    },
    {
        "id": "e01", "file": "Giotto di Bondone 026.jpg", "periodId": "early-renaissance",
        "titleZh": "哀悼基督", "titleEn": "The Lamentation of Christ",
        "artistId": "giotto", "artistNameZh": "乔托", "artistNameEn": "Giotto di Bondone",
        "artistBorn": 1267, "artistDied": 1337, "nationality": "意大利",
        "year": "约1305",
        "description": "乔托让圣徒拥有重量、体块与真实悲恸，阿雷纳礼拜堂壁画由此把人性的尊严带进神圣叙事。"
    },
    {
        "id": "e02", "file": "Van Eyck - Arnolfini Portrait.jpg", "periodId": "early-renaissance",
        "titleZh": "阿尔诺菲尼夫妇像", "titleEn": "The Arnolfini Portrait",
        "artistId": "vaneyck", "artistNameZh": "扬·凡·艾克", "artistNameEn": "Jan van Eyck",
        "artistBorn": 1390, "artistDied": 1441, "nationality": "法兰德斯",
        "year": "1434",
        "description": "凸镜、吊灯与精细衣物把婚姻现场变成可验证的见证，凡·艾克以油画技术确立北欧自然主义的高峰。"
    },
    {
        "id": "e03", "file": "Sandro Botticelli - La nascita di Venere - Google Art Project.jpg", "periodId": "early-renaissance",
        "titleZh": "维纳斯的诞生", "titleEn": "The Birth of Venus",
        "artistId": "botticelli", "artistNameZh": "波提切利", "artistNameEn": "Sandro Botticelli",
        "artistBorn": 1445, "artistDied": 1510, "nationality": "意大利",
        "year": "约1485",
        "description": "人文主义重新召唤古代神话，波提切利以流动线条让美从贝壳中降临，塑造文艺复兴对古典精神的情感想象。"
    },
    {
        "id": "e04", "file": "Angelico Annunciation (Cortona).jpg", "periodId": "early-renaissance",
        "titleZh": "天使报喜", "titleEn": "The Annunciation",
        "artistId": "fraangelico", "artistNameZh": "弗拉·安杰利科", "artistNameEn": "Fra Angelico",
        "artistBorn": 1395, "artistDied": 1455, "nationality": "意大利",
        "year": "约1440",
        "description": "柔和光线与纯净建筑把神迹置于日常尺度，安杰利科以谦逊而明亮的色彩让信仰获得可见的和谐。"
    },
    {
        "id": "e05", "file": "Masaccio-TheExpulsionOfAdamAndEveFromEden-Restoration.jpg", "periodId": "early-renaissance",
        "titleZh": "逐出伊甸园", "titleEn": "The Expulsion of Adam and Eve from Paradise",
        "artistId": "masaccio", "artistNameZh": "马萨乔", "artistNameEn": "Masaccio",
        "artistBorn": 1401, "artistDied": 1428, "nationality": "意大利",
        "year": "约1425",
        "description": "亚当与夏娃不再是程式化圣像，而是承受羞耻与哀痛的肉体，马萨乔用光影和体积打开文艺复兴的人性尺度。"
    },
    {
        "id": "e06", "file": "Piero, battesimo di cristo 04.jpg", "periodId": "early-renaissance",
        "titleZh": "基督受洗", "titleEn": "The Baptism of Christ",
        "artistId": "piero", "artistNameZh": "皮耶罗·德拉·弗朗切斯卡", "artistNameEn": "Piero della Francesca",
        "artistBorn": 1415, "artistDied": 1492, "nationality": "意大利",
        "year": "约1448-1450",
        "description": "几何秩序与几何透视让神圣事件显得永恒而清晰，皮耶罗以近乎音乐的平衡呈现文艺复兴对理性的信仰。"
    },
    {
        "id": "h01", "file": "Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg", "periodId": "high-renaissance",
        "titleZh": "蒙娜丽莎", "titleEn": "Mona Lisa",
        "artistId": "leonardo", "artistNameZh": "列奥纳多·达·芬奇", "artistNameEn": "Leonardo da Vinci",
        "artistBorn": 1452, "artistDied": 1519, "nationality": "意大利",
        "year": "约1503-1519",
        "description": "晕涂法让轮廓融入空气与阴影，蒙娜丽莎的微笑成为现代个体意识最持久的图像谜题。"
    },
    {
        "id": "h02", "file": "Leonardo da Vinci (1452-1519) - The Last Supper (1495-1498).jpg", "periodId": "high-renaissance",
        "titleZh": "最后的晚餐", "titleEn": "The Last Supper",
        "artistId": "leonardo", "artistNameZh": "列奥纳多·达·芬奇", "artistNameEn": "Leonardo da Vinci",
        "artistBorn": 1452, "artistDied": 1519, "nationality": "意大利",
        "year": "1495-1498",
        "description": "达·芬奇把耶稣宣布背叛的瞬间压缩成心理群像，透视会聚于中心，使叙事、科学与戏剧同时成立。"
    },
    {
        "id": "h03", "file": "\"The School of Athens\" by Raffaello Sanzio da Urbino.jpg", "periodId": "high-renaissance",
        "titleZh": "雅典学院", "titleEn": "The School of Athens",
        "artistId": "raphael", "artistNameZh": "拉斐尔", "artistNameEn": "Raphael",
        "artistBorn": 1483, "artistDied": 1520, "nationality": "意大利",
        "year": "1509-1511",
        "description": "柏拉图和亚里士多德在宏伟建筑中辩论，拉斐尔把古典哲学与文艺复兴人文精神铸成理想秩序。"
    },
    {
        "id": "h04", "file": "Michelangelo - Creation of Adam (cropped).jpg", "periodId": "high-renaissance",
        "titleZh": "创造亚当", "titleEn": "The Creation of Adam",
        "artistId": "michelangelo", "artistNameZh": "米开朗琪罗", "artistNameEn": "Michelangelo",
        "artistBorn": 1475, "artistDied": 1564, "nationality": "意大利",
        "year": "约1511",
        "description": "两指将触未触的间隙被画成宇宙起源的悬置瞬间，西斯廷天顶把人体力学提升为神学与哲学的双重证明。"
    },
    {
        "id": "h05", "file": "Tiziano - Venere di Urbino - Google Art Project.jpg", "periodId": "high-renaissance",
        "titleZh": "乌尔比诺的维纳斯", "titleEn": "Venus of Urbino",
        "artistId": "titian", "artistNameZh": "提香", "artistNameEn": "Titian",
        "artistBorn": 1490, "artistDied": 1576, "nationality": "意大利",
        "year": "1538",
        "description": "提香让古典女神住进威尼斯贵族卧室，暖色、丝绸与身体共同塑造世俗欲望与绘画感官性的典范。"
    },
    {
        "id": "h06", "file": "Albrecht Dürer - 1500 self-portrait (High resolution and detail).jpg", "periodId": "high-renaissance",
        "titleZh": "自画像", "titleEn": "Self-Portrait at 28",
        "artistId": "durer", "artistNameZh": "阿尔布雷希特·丢勒", "artistNameEn": "Albrecht Dürer",
        "artistBorn": 1471, "artistDied": 1528, "nationality": "德国",
        "year": "1500",
        "description": "丢勒以近乎基督正面的构图凝视观者，北方画家第一次把自身位置提升到近乎神圣创造者。"
    },
    {
        "id": "h07", "file": "6,99Mo-Giorgione 019.jpg", "periodId": "high-renaissance",
        "titleZh": "暴风雨", "titleEn": "The Tempest",
        "artistId": "giorgione", "artistNameZh": "乔尔乔内", "artistNameEn": "Giorgione",
        "artistBorn": 1477, "artistDied": 1510, "nationality": "意大利",
        "year": "约1508",
        "description": "人物、闪电与风景共同构成无法被简单解读的抒情场面，乔尔乔内让绘画脱离文本而拥有自足诗意。"
    },
    {
        "id": "b01", "file": "Caravaggio, Michelangelo Merisi da - The Calling of Saint Matthew - 1599-1600 (hi res).jpg", "periodId": "baroque",
        "titleZh": "圣马太蒙召", "titleEn": "The Calling of Saint Matthew",
        "artistId": "caravaggio", "artistNameZh": "卡拉瓦乔", "artistNameEn": "Caravaggio",
        "artistBorn": 1571, "artistDied": 1610, "nationality": "意大利",
        "year": "1599-1600",
        "description": "光线如手指般从右侧切入税吏房间，卡拉瓦乔把神圣召唤放进昏暗日常，以黑暗和真实重构宗教图像。"
    },
    {
        "id": "b02", "file": "Judith Beheading Holofernes - Caravaggio.jpg", "periodId": "baroque",
        "titleZh": "朱迪斯斩杀霍洛芬尼斯", "titleEn": "Judith Beheading Holofernes",
        "artistId": "caravaggio", "artistNameZh": "卡拉瓦乔", "artistNameEn": "Caravaggio",
        "artistBorn": 1571, "artistDied": 1610, "nationality": "意大利",
        "year": "约1598-1599",
        "description": "斩首瞬间的血迹、皱纹与喷溅被照得无比刺目，巴洛克艺术以身体暴力的真实唤起强烈精神感受。"
    },
    {
        "id": "b03", "file": "Peter Paul Rubens - The Judgement of Paris - Google Art Project.jpg", "periodId": "baroque",
        "titleZh": "帕里斯的审判", "titleEn": "The Judgement of Paris",
        "artistId": "rubens", "artistNameZh": "鲁本斯", "artistNameEn": "Peter Paul Rubens",
        "artistBorn": 1577, "artistDied": 1640, "nationality": "法兰德斯",
        "year": "约1636",
        "description": "鲁本斯以饱满肉体、绸缎和树木把古代神话变成触觉盛宴，巴洛克运动感在画面中持续扩散。"
    },
    {
        "id": "b04", "file": "La ronda de noche, por Rembrandt van Rijn.jpg", "periodId": "baroque",
        "titleZh": "夜巡", "titleEn": "The Night Watch",
        "artistId": "rembrandt", "artistNameZh": "伦勃朗", "artistNameEn": "Rembrandt van Rijn",
        "artistBorn": 1606, "artistDied": 1669, "nationality": "荷兰",
        "year": "1642",
        "description": "伦勃朗把市民自卫队群像变成正在发生的行动剧场，光、影与运动的交错让集体肖像获得史诗感。"
    },
    {
        "id": "b05", "file": "1665 Girl with a Pearl Earring.jpg", "periodId": "baroque",
        "titleZh": "戴珍珠耳环的少女", "titleEn": "Girl with a Pearl Earring",
        "artistId": "vermeer", "artistNameZh": "维米尔", "artistNameEn": "Johannes Vermeer",
        "artistBorn": 1632, "artistDied": 1675, "nationality": "荷兰",
        "year": "约1665",
        "description": "回眸、珠光与深色背景让日常少女成为永恒凝视，维米尔以光学般的冷静描绘心灵瞬间。"
    },
    {
        "id": "b06", "file": "Las Meninas, by Diego Velázquez, from Prado in Google Earth.jpg", "periodId": "baroque",
        "titleZh": "宫娥", "titleEn": "Las Meninas",
        "artistId": "velazquez", "artistNameZh": "委拉斯贵支", "artistNameEn": "Diego Velázquez",
        "artistBorn": 1599, "artistDied": 1660, "nationality": "西班牙",
        "year": "1656",
        "description": "画家、公主、镜中君王与观者互相注视，委拉斯贵支让绘画、权力与观看本身成为画面真正主题。"
    },
    {
        "id": "b07", "file": "Artemisia Gentileschi - Judith Beheading Holofernes - WGA8563.jpg", "periodId": "baroque",
        "titleZh": "朱迪斯斩杀霍洛芬尼斯", "titleEn": "Judith Slaying Holofernes",
        "artistId": "gentileschi", "artistNameZh": "阿尔泰米西娅·真蒂莱斯基", "artistNameEn": "Artemisia Gentileschi",
        "artistBorn": 1593, "artistDied": 1656, "nationality": "意大利",
        "year": "约1614-1620",
        "description": "女性手臂真实发力、肌肉紧绷，真蒂莱斯基以切身经验重写英雄叙事，是巴洛克最具身体性的图像之一。"
    },
    {
        "id": "r01", "file": "L'Embarquement pour Cythère, by Antoine Watteau, from C2RMF retouched.jpg", "periodId": "rococo-neoclassicism",
        "titleZh": "舟发西苔岛", "titleEn": "Pilgrimage to Cythera",
        "artistId": "watteau", "artistNameZh": "华托", "artistNameEn": "Antoine Watteau",
        "artistBorn": 1684, "artistDied": 1721, "nationality": "法国",
        "year": "1717",
        "description": "华托创造“雅宴画”，贵族男女在梦幻园林中启程前往爱情岛屿，洛可可艺术以优雅装饰掩饰时光易逝。"
    },
    {
        "id": "r02", "file": "Joean Honoré Fragonard - The Swing.jpg", "periodId": "rococo-neoclassicism",
        "titleZh": "秋千", "titleEn": "The Swing",
        "artistId": "fragonard", "artistNameZh": "弗拉戈纳尔", "artistNameEn": "Jean-Honoré Fragonard",
        "artistBorn": 1732, "artistDied": 1806, "nationality": "法国",
        "year": "1767-1768",
        "description": "飞起的粉裙、暗处的情人与灌木间的视线构成一场轻佻游戏，洛可可的感官愉悦达到顶点。"
    },
    {
        "id": "r03", "file": "Thomas Gainsborough - The Blue Boy (c. 1770).jpg", "periodId": "rococo-neoclassicism",
        "titleZh": "蓝衣少年", "titleEn": "The Blue Boy",
        "artistId": "gainsborough", "artistNameZh": "庚斯博罗", "artistNameEn": "Thomas Gainsborough",
        "artistBorn": 1727, "artistDied": 1788, "nationality": "英国",
        "year": "约1770",
        "description": "蓝色缎面与流动笔触让肖像超越身份记录，庚斯博罗把英国贵族肖像提升为优雅而抒情的艺术。"
    },
    {
        "id": "r04", "file": "Jacques-Louis David - Oath of the Horatii - Google Art Project.jpg", "periodId": "rococo-neoclassicism",
        "titleZh": "荷拉斯兄弟之誓", "titleEn": "Oath of the Horatii",
        "artistId": "david", "artistNameZh": "雅克-路易·大卫", "artistNameEn": "Jacques-Louis David",
        "artistBorn": 1748, "artistDied": 1825, "nationality": "法国",
        "year": "1784",
        "description": "罗马式誓言、立柱与明确光影把公民牺牲变成启蒙道德课，新古典主义为革命年代提供视觉纲领。"
    },
    {
        "id": "r05", "file": "David - The Death of Socrates.jpg", "periodId": "rococo-neoclassicism",
        "titleZh": "苏格拉底之死", "titleEn": "The Death of Socrates",
        "artistId": "david", "artistNameZh": "雅克-路易·大卫", "artistNameEn": "Jacques-Louis David",
        "artistBorn": 1748, "artistDied": 1825, "nationality": "法国",
        "year": "1787",
        "description": "苏格拉底在牢狱中从容饮下毒酒，大卫以古代哲学家的死亡为理性与原则殉道者立像。"
    },
    {
        "id": "r06", "file": "Vigée Le Brun, Élisabeth - Marie-Antoinette en gaulle, 1783.JPG", "periodId": "rococo-neoclassicism",
        "titleZh": "玛丽·安托瓦内特身着素衣", "titleEn": "Marie Antoinette en Gaulle",
        "artistId": "vigelebrun", "artistNameZh": "伊丽莎白·维杰-勒布伦", "artistNameEn": "Élisabeth Vigée Le Brun",
        "artistBorn": 1755, "artistDied": 1842, "nationality": "法国",
        "year": "1783",
        "description": "画家以轻简衣着和自然姿态描绘法国王后，肖像在宫廷规范与个人魅力之间游走，也成为女性艺术家职业身份的见证。"
    },
    {
        "id": "r07", "file": "La familia de Carlos IV.jpg", "periodId": "rococo-neoclassicism",
        "titleZh": "查理四世一家", "titleEn": "The Family of Charles IV",
        "artistId": "goya", "artistNameZh": "弗朗西斯科·戈雅", "artistNameEn": "Francisco de Goya",
        "artistBorn": 1746, "artistDied": 1828, "nationality": "西班牙",
        "year": "1800-1801",
        "description": "戈雅以近乎无情的写实描绘王室，华丽衣饰下露出庸常与脆弱，预示宫廷肖像批判的新阶段。"
    },
    {
        "id": "m01", "file": "JEAN LOUIS THÉODORE GÉRICAULT - La Balsa de la Medusa (Museo del Louvre, 1818-19).jpg", "periodId": "romanticism",
        "titleZh": "美杜莎之筏", "titleEn": "The Raft of the Medusa",
        "artistId": "gericault", "artistNameZh": "泰奥多尔·籍里柯", "artistNameEn": "Théodore Géricault",
        "artistBorn": 1791, "artistDied": 1824, "nationality": "法国",
        "year": "1818-1819",
        "description": "海难幸存者在木筏上挣扎远望，籍里柯把当代政治丑闻画成悲剧纪念碑，浪漫主义以历史现场震撼公众。"
    },
    {
        "id": "m02", "file": "Eugène Delacroix - Le 28 Juillet. La Liberté guidant le peuple.jpg", "periodId": "romanticism",
        "titleZh": "自由引导人民", "titleEn": "Liberty Leading the People",
        "artistId": "delacroix", "artistNameZh": "欧仁·德拉克洛瓦", "artistNameEn": "Eugène Delacroix",
        "artistBorn": 1798, "artistDied": 1863, "nationality": "法国",
        "year": "1830",
        "description": "自由女神持旗踏过街垒，德拉克洛瓦把革命能量、女神寓意与具体人物熔成一幅国家象征。"
    },
    {
        "id": "m03", "file": "Death of Sardanapalus by Eugène Delacroix.jpg", "periodId": "romanticism",
        "titleZh": "萨达纳帕卢斯之死", "titleEn": "The Death of Sardanapalus",
        "artistId": "delacroix", "artistNameZh": "欧仁·德拉克洛瓦", "artistNameEn": "Eugène Delacroix",
        "artistBorn": 1798, "artistDied": 1863, "nationality": "法国",
        "year": "1827",
        "description": "东方暴君在毁灭中纵情凝视混乱，德拉克洛瓦以燃烧般的色彩和堆叠肉体呈现浪漫主义对极限的迷恋。"
    },
    {
        "id": "m04", "file": "The Fighting Temeraire, JMW Turner, National Gallery.jpg", "periodId": "romanticism",
        "titleZh": "被拖去解体的无畏号", "titleEn": "The Fighting Temeraire",
        "artistId": "turner", "artistNameZh": "约瑟夫·马洛德·威廉·透纳", "artistNameEn": "J. M. W. Turner",
        "artistBorn": 1775, "artistDied": 1851, "nationality": "英国",
        "year": "1839",
        "description": "夕阳、蒸汽与旧战舰共同沉入历史，透纳让工业时代与英雄过去在光色中完成告别。"
    },
    {
        "id": "m05", "file": "Turner - Rain, Steam and Speed - National Gallery file.jpg", "periodId": "romanticism",
        "titleZh": "雨、蒸汽与速度", "titleEn": "Rain, Steam and Speed",
        "artistId": "turner", "artistNameZh": "约瑟夫·马洛德·威廉·透纳", "artistNameEn": "J. M. W. Turner",
        "artistBorn": 1775, "artistDied": 1851, "nationality": "英国",
        "year": "1844",
        "description": "火车从雨雾中飞驰而出，透纳把速度、空气和光的振动画成浪漫主义对现代性的预感。"
    },
    {
        "id": "m06", "file": "Caspar David Friedrich - Wanderer above the sea of fog.jpg", "periodId": "romanticism",
        "titleZh": "雾海上的旅人", "titleEn": "Wanderer above the Sea of Fog",
        "artistId": "friedrich", "artistNameZh": "卡斯帕·大卫·弗里德里希", "artistNameEn": "Caspar David Friedrich",
        "artistBorn": 1774, "artistDied": 1840, "nationality": "德国",
        "year": "约1818",
        "description": "背对观者的旅人站立于群山云海之上，弗里德里希把个人心灵与自然崇高同时置入无边风景。"
    },
    {
        "id": "m07", "file": "John Constable - The Hay Wain (1821).jpg", "periodId": "romanticism",
        "titleZh": "干草车", "titleEn": "The Hay Wain",
        "artistId": "constable", "artistNameZh": "约翰·康斯太勃尔", "artistNameEn": "John Constable",
        "artistBorn": 1776, "artistDied": 1837, "nationality": "英国",
        "year": "1821",
        "description": "云层、水光与乡间车马构成恬静的英国田园，康斯太勃尔以对自然的耐心观察赢得浪漫时代的共鸣。"
    },
    {
        "id": "s01", "file": "Gustave Courbet - A Burial at Ornans - Google Art Project.jpg", "periodId": "realism",
        "titleZh": "奥尔南的葬礼", "titleEn": "A Burial at Ornans",
        "artistId": "courbet", "artistNameZh": "居斯塔夫·库尔贝", "artistNameEn": "Gustave Courbet",
        "artistBorn": 1819, "artistDied": 1877, "nationality": "法国",
        "year": "1849-1850",
        "description": "乡村葬礼被画成历史画尺度的群像，库尔贝拒绝崇高题材，把普通人的死亡与仪式交给公众凝视。"
    },
    {
        "id": "s02", "file": "Jean-François Millet - Gleaners - Google Art Project.jpg", "periodId": "realism",
        "titleZh": "拾穗者", "titleEn": "The Gleaners",
        "artistId": "millet", "artistNameZh": "让-弗朗索瓦·米勒", "artistNameEn": "Jean-François Millet",
        "artistBorn": 1814, "artistDied": 1875, "nationality": "法国",
        "year": "1857",
        "description": "三位农妇在收割后的田地里弯腰拾穗，米勒以纪念碑式构图赋予劳动以尊严和静默。"
    },
    {
        "id": "s03", "file": "Jean-François Millet - The Angelus - Google Art Project.jpg", "periodId": "realism",
        "titleZh": "晚祷", "titleEn": "The Angelus",
        "artistId": "millet", "artistNameZh": "让-弗朗索瓦·米勒", "artistNameEn": "Jean-François Millet",
        "artistBorn": 1814, "artistDied": 1875, "nationality": "法国",
        "year": "1857-1859",
        "description": "暮色中农人放下工具祈祷，米勒把乡村宗教时辰画成现代生活的精神回声。"
    },
    {
        "id": "s04", "file": "Edouard Manet - Olympia - Google Art Project 3.jpg", "periodId": "realism",
        "titleZh": "奥林匹亚", "titleEn": "Olympia",
        "artistId": "manet", "artistNameZh": "爱德华·马奈", "artistNameEn": "Édouard Manet",
        "artistBorn": 1832, "artistDied": 1883, "nationality": "法国",
        "year": "1863",
        "description": "妓女以坦然目光直视观众，马奈以扁平色块和现代题材挑战学院传统，被视为现代绘画的起点之一。"
    },
    {
        "id": "s05", "file": "Edouard Manet, A Bar at the Folies-Bergère.jpg", "periodId": "realism",
        "titleZh": "女神游乐厅的吧台", "titleEn": "A Bar at the Folies-Bergère",
        "artistId": "manet", "artistNameZh": "爱德华·马奈", "artistNameEn": "Édouard Manet",
        "artistBorn": 1832, "artistDied": 1883, "nationality": "法国",
        "year": "1882",
        "description": "女侍、镜中人群与瓶中酒构成城市夜生活的一瞬，马奈以不确定的镜像关系追问现代观看本身。"
    },
    {
        "id": "s06", "file": "Souvenir de Mortefontaine - Jean-Baptiste Camille Corot - Musée du Louvre Peintures MI 692 bis - photo 2.jpg", "periodId": "realism",
        "titleZh": "孟特枫丹的回忆", "titleEn": "Souvenir de Mortefontaine",
        "artistId": "corot", "artistNameZh": "让-巴蒂斯特-卡米耶·柯罗", "artistNameEn": "Jean-Baptiste-Camille Corot",
        "artistBorn": 1796, "artistDied": 1875, "nationality": "法国",
        "year": "1864",
        "description": "银灰色树影与水面让自然风景带上抒情回忆，柯罗连接古典风景与后来的外光写实。"
    },
    {
        "id": "i01", "file": "Claude Monet, Impression, soleil levant.jpg", "periodId": "impressionism",
        "titleZh": "日出·印象", "titleEn": "Impression, Sunrise",
        "artistId": "monet", "artistNameZh": "克劳德·莫奈", "artistNameEn": "Claude Monet",
        "artistBorn": 1840, "artistDied": 1926, "nationality": "法国",
        "year": "1872",
        "description": "勒阿弗尔港口的晨雾、橙日与倒影被快速笔触留在画布，作品名称催生了“印象派”这一标签。"
    },
    {
        "id": "i02", "file": "Claude Monet - Water Lilies - Google Art Project.jpg", "periodId": "impressionism",
        "titleZh": "睡莲", "titleEn": "Water Lilies",
        "artistId": "monet", "artistNameZh": "克劳德·莫奈", "artistNameEn": "Claude Monet",
        "artistBorn": 1840, "artistDied": 1926, "nationality": "法国",
        "year": "1906",
        "description": "莫奈晚年反复描绘吉维尼池塘，水面、倒影和光线近乎抽象，成为印象派通向现代绘画的桥梁。"
    },
    {
        "id": "i03", "file": "Claude Monet - Rouen Cathedral, Facade (Sunset).JPG", "periodId": "impressionism",
        "titleZh": "鲁昂大教堂：黄昏立面", "titleEn": "Rouen Cathedral, Facade at Sunset",
        "artistId": "monet", "artistNameZh": "克劳德·莫奈", "artistNameEn": "Claude Monet",
        "artistBorn": 1840, "artistDied": 1926, "nationality": "法国",
        "year": "1892-1894",
        "description": "同一座哥特立面在不同时刻呈现不同色彩，莫奈证明绘画主题可以是光线本身。"
    },
    {
        "id": "i04", "file": "Renoir, Pierre-Auguste - Dance at Le Moulin de la Galette, 1876.jpg", "periodId": "impressionism",
        "titleZh": "煎饼磨坊的舞会", "titleEn": "Dance at Le Moulin de la Galette",
        "artistId": "renoir", "artistNameZh": "皮埃尔-奥古斯特·雷诺阿", "artistNameEn": "Pierre-Auguste Renoir",
        "artistBorn": 1841, "artistDied": 1919, "nationality": "法国",
        "year": "1876",
        "description": "阳光穿过树荫落在舞者与酒桌上，雷诺阿用温暖色彩记录巴黎大众娱乐的愉悦瞬间。"
    },
    {
        "id": "i05", "file": "Pierre-Auguste Renoir - Luncheon of the Boating Party - Google Art Project.jpg", "periodId": "impressionism",
        "titleZh": "船上的午宴", "titleEn": "Luncheon of the Boating Party",
        "artistId": "renoir", "artistNameZh": "皮埃尔-奥古斯特·雷诺阿", "artistNameEn": "Pierre-Auguste Renoir",
        "artistBorn": 1841, "artistDied": 1919, "nationality": "法国",
        "year": "1880-1881",
        "description": "朋友、酒杯、果子和塞纳河景色挤满阳台，雷诺阿把印象派的社交欢愉推到顶峰。"
    },
    {
        "id": "i06", "file": "Edgar Germain Hilaire Degas 021.jpg", "periodId": "impressionism",
        "titleZh": "舞蹈课", "titleEn": "The Dance Class",
        "artistId": "degas", "artistNameZh": "埃德加·德加", "artistNameEn": "Edgar Degas",
        "artistBorn": 1834, "artistDied": 1917, "nationality": "法国",
        "year": "约1874",
        "description": "德加以倾斜构图和偶然视角观察芭蕾排练，现代城市身体在严格训练与日常松弛之间显形。"
    },
    {
        "id": "i07", "file": "Camille Pissarro, The Boulevard Montmartre at Night, 1897.jpg", "periodId": "impressionism",
        "titleZh": "蒙马特大道之夜", "titleEn": "Boulevard Montmartre at Night",
        "artistId": "pissarro", "artistNameZh": "卡米耶·毕沙罗", "artistNameEn": "Camille Pissarro",
        "artistBorn": 1830, "artistDied": 1903, "nationality": "法国",
        "year": "1897",
        "description": "城市路灯、马车与行人化为跃动的色点，毕沙罗把现代都市节奏纳入印象派的光色实验。"
    },
    {
        "id": "p01", "file": "Van Gogh - Starry Night - Google Art Project.jpg", "periodId": "post-impressionism",
        "titleZh": "星月夜", "titleEn": "The Starry Night",
        "artistId": "vangogh", "artistNameZh": "文森特·梵高", "artistNameEn": "Vincent van Gogh",
        "artistBorn": 1853, "artistDied": 1890, "nationality": "荷兰",
        "year": "1889",
        "description": "旋转的星云、明亮月轮与沉睡村庄共同构成内在宇宙，梵高让风景成为灵魂震颤的现场。"
    },
    {
        "id": "p02", "file": "Vincent van Gogh - Sunflowers - VGM F458.jpg", "periodId": "post-impressionism",
        "titleZh": "向日葵", "titleEn": "Sunflowers",
        "artistId": "vangogh", "artistNameZh": "文森特·梵高", "artistNameEn": "Vincent van Gogh",
        "artistBorn": 1853, "artistDied": 1890, "nationality": "荷兰",
        "year": "1888-1889",
        "description": "厚涂颜料让向日葵的花瓣如火焰般隆起，梵高以色彩和笔触直接表达生命能量。"
    },
    {
        "id": "p03", "file": "La Montagne Sainte-Victoire vue de la carrière Bibémus, par Paul Cézanne.jpg", "periodId": "post-impressionism",
        "titleZh": "圣维克多山", "titleEn": "Mont Sainte-Victoire",
        "artistId": "cezanne", "artistNameZh": "保罗·塞尚", "artistNameEn": "Paul Cézanne",
        "artistBorn": 1839, "artistDied": 1906, "nationality": "法国",
        "year": "约1890",
        "description": "塞尚把山、树与房屋拆解为相互呼应的色块结构，被后来艺术家视为通向立体主义的关键起点。"
    },
    {
        "id": "p04", "file": "Gauguin - Where Do We Come From? What Are We? Where Are We Going? (1897-98).jpg", "periodId": "post-impressionism",
        "titleZh": "我们从何处来？我们是谁？我们向何处去？", "titleEn": "Where Do We Come From? What Are We? Where Are We Going?",
        "artistId": "gauguin", "artistNameZh": "保罗·高更", "artistNameEn": "Paul Gauguin",
        "artistBorn": 1848, "artistDied": 1903, "nationality": "法国",
        "year": "1897-1898",
        "description": "高更在塔希提完成巨幅生命寓言，装饰性色彩与原始形象共同追问存在、起源与归宿。"
    },
    {
        "id": "p05", "file": "A Sunday on La Grande Jatte, Georges Seurat, 1884.jpg", "periodId": "post-impressionism",
        "titleZh": "大碗岛的星期天下午", "titleEn": "A Sunday Afternoon on the Island of La Grande Jatte",
        "artistId": "seurat", "artistNameZh": "乔治·修拉", "artistNameEn": "Georges Seurat",
        "artistBorn": 1859, "artistDied": 1891, "nationality": "法国",
        "year": "1884-1886",
        "description": "修拉用科学点彩把巴黎郊游者凝固成静止仪式，印象派的瞬间感觉由此变成结构化的现代秩序。"
    },
    {
        "id": "p06", "file": "The Scream.jpg", "periodId": "post-impressionism",
        "titleZh": "呐喊", "titleEn": "The Scream",
        "artistId": "munch", "artistNameZh": "爱德华·蒙克", "artistNameEn": "Edvard Munch",
        "artistBorn": 1863, "artistDied": 1944, "nationality": "挪威",
        "year": "1893",
        "description": "波浪状的天空与尖叫般的人物把焦虑外化为视觉声波，蒙克使心理状态成为现代艺术的核心题材。"
    },
    {
        "id": "p07", "file": "Gustav Klimt 016.jpg", "periodId": "post-impressionism",
        "titleZh": "吻", "titleEn": "The Kiss",
        "artistId": "klimt", "artistNameZh": "古斯塔夫·克里姆特", "artistNameEn": "Gustav Klimt",
        "artistBorn": 1862, "artistDied": 1918, "nationality": "奥地利",
        "year": "1907-1908",
        "description": "黄金装饰、镶嵌般的图案与拥吻男女交织，克里姆特以维也纳分离派的装饰语言重塑爱与永恒。"
    },
    {
        "id": "v01", "file": "The Dance by Henri Matisse at the Hermitage.jpg", "periodId": "modern-avant-garde",
        "titleZh": "舞蹈", "titleEn": "The Dance",
        "artistId": "matisse", "artistNameZh": "亨利·马蒂斯", "artistNameEn": "Henri Matisse",
        "artistBorn": 1869, "artistDied": 1954, "nationality": "法国",
        "year": "1910",
        "description": "五位舞者手拉手围成红色圆环，马蒂斯以纯色与简化形体让绘画回归最纯粹的生命节奏。"
    },
    {
        "id": "v02", "file": "Composition VII - Wassily Kandinsky, GAC.jpg", "periodId": "modern-avant-garde",
        "titleZh": "构成第七号", "titleEn": "Composition VII",
        "artistId": "kandinsky", "artistNameZh": "瓦西里·康定斯基", "artistNameEn": "Wassily Kandinsky",
        "artistBorn": 1866, "artistDied": 1944, "nationality": "俄国",
        "year": "1913",
        "description": "色彩、线条和形体在画布上如音乐般相互碰撞，康定斯基把抽象绘画提升为内在精神的视觉交响。"
    },
    {
        "id": "v03", "file": "Piet Mondriaan, 1930 - Mondrian Composition II in Red, Blue, and Yellow.jpg", "periodId": "modern-avant-garde",
        "titleZh": "红黄蓝构图", "titleEn": "Composition with Red, Blue and Yellow",
        "artistId": "mondrian", "artistNameZh": "皮特·蒙德里安", "artistNameEn": "Piet Mondrian",
        "artistBorn": 1872, "artistDied": 1944, "nationality": "荷兰",
        "year": "1921",
        "description": "黑线、原色与留白构成绝对平衡，蒙德里安以新造型主义把世界简化为普遍性的几何秩序。"
    },
    {
        "id": "v04", "file": "Malevich, Kazimir Severinovich - Black Square.jpg", "periodId": "modern-avant-garde",
        "titleZh": "黑色正方形", "titleEn": "Black Square",
        "artistId": "malevich", "artistNameZh": "卡济米尔·马列维奇", "artistNameEn": "Kazimir Malevich",
        "artistBorn": 1879, "artistDied": 1935, "nationality": "俄国",
        "year": "1915",
        "description": "黑色方块悬浮于白底，马列维奇宣告绘画可以脱离物体与叙事，成为至上主义的零度起点。"
    },
    {
        "id": "v05", "file": "Paul Klee, 1922, Senecio, oil on gauze, 40.3 × 37.4 cm, Kunstmuseum Basel.jpg", "periodId": "modern-avant-garde",
        "titleZh": "塞内西奥", "titleEn": "Senecio",
        "artistId": "klee", "artistNameZh": "保罗·克利", "artistNameEn": "Paul Klee",
        "artistBorn": 1879, "artistDied": 1940, "nationality": "德国",
        "year": "1922",
        "description": "圆形、几何块面与色彩拼出半人半面具的脸，克利在理性构成中保留儿童般的直觉和幽默。"
    },
    {
        "id": "v06", "file": "Marc, Franz - Blue Horse I - Google Art Project.jpg", "periodId": "modern-avant-garde",
        "titleZh": "蓝马一号", "titleEn": "Blue Horse I",
        "artistId": "marc", "artistNameZh": "弗朗茨·马尔克", "artistNameEn": "Franz Marc",
        "artistBorn": 1880, "artistDied": 1916, "nationality": "德国",
        "year": "1911",
        "description": "蓝马弯曲的轮廓与红色山丘共同呼吸，马尔克用非自然色彩寻找动物与自然的精神本质。"
    },
    {
        "id": "v07", "file": "Ernst Ludwig Kirchner, 1913, Street, Berlin, oil on canvas, 120.6 x 91.1 cm, MoMA.jpg", "periodId": "modern-avant-garde",
        "titleZh": "柏林街道", "titleEn": "Street, Berlin",
        "artistId": "kirchner", "artistNameZh": "恩斯特·路德维希·基希纳", "artistNameEn": "Ernst Ludwig Kirchner",
        "artistBorn": 1880, "artistDied": 1938, "nationality": "德国",
        "year": "1913",
        "description": "尖角、斜线与刺目色彩让现代都市像欲望剧场，基希纳用表现主义记录柏林街头的眩晕与孤独。"
    },
    {
        "id": "x01", "file": "The City Rises by Umberto Boccioni 1910.jpg", "periodId": "expressionism-beyond",
        "titleZh": "城市在上升", "titleEn": "The City Rises",
        "artistId": "boccioni", "artistNameZh": "翁贝托·薄邱尼", "artistNameEn": "Umberto Boccioni",
        "artistBorn": 1882, "artistDied": 1916, "nationality": "意大利",
        "year": "1910",
        "description": "马匹、工人与建筑在光线中扩散为连续能量，未来主义把速度、劳动和城市生命画成动态力量。"
    },
    {
        "id": "x02", "file": "Amedeo Modigliani Reclining Nude The Metropolitan Museum of Art.jpg", "periodId": "expressionism-beyond",
        "titleZh": "躺卧的裸女", "titleEn": "Reclining Nude",
        "artistId": "modigliani", "artistNameZh": "阿梅代奥·莫迪利亚尼", "artistNameEn": "Amedeo Modigliani",
        "artistBorn": 1884, "artistDied": 1920, "nationality": "意大利",
        "year": "1917",
        "description": "拉长的身体与暖色轮廓让现代人体充满私密感，莫迪利亚尼把巴黎画派的线条化为优雅沉默。"
    },
    {
        "id": "x03", "file": "Egon Schiele - Portrait of Edith (the artist's wife) - Google Art Project.jpg", "periodId": "expressionism-beyond",
        "titleZh": "艺术家妻子埃迪特的肖像", "titleEn": "Portrait of the Artist's Wife Edith",
        "artistId": "schiele", "artistNameZh": "埃贡·席勒", "artistNameEn": "Egon Schiele",
        "artistBorn": 1890, "artistDied": 1918, "nationality": "奥地利",
        "year": "1917",
        "description": "瘦削形体、裸露肩膀与注视目光充满紧张，席勒以神经质的线条探索身体、心理与亲密关系。"
    },
    {
        "id": "x04", "file": "Beckmann Max-Die-Nacht Kunstsammlung NRW 1024.jpg", "periodId": "expressionism-beyond",
        "titleZh": "夜", "titleEn": "The Night",
        "artistId": "beckmann", "artistNameZh": "马克斯·贝克曼", "artistNameEn": "Max Beckmann",
        "artistBorn": 1884, "artistDied": 1950, "nationality": "德国",
        "year": "1918-1919",
        "description": "扭曲室内空间里人物被暴力压缩与拧转，贝克曼以战后画面呈现现代社会的创伤和异化。"
    },
    {
        "id": "x05", "file": "Die Zwitscher-Maschine (Twittering Machine), 1922 - Paul Klee.jpg", "periodId": "expressionism-beyond",
        "titleZh": "鸣叫机器", "titleEn": "Twittering Machine",
        "artistId": "klee", "artistNameZh": "保罗·克利", "artistNameEn": "Paul Klee",
        "artistBorn": 1879, "artistDied": 1940, "nationality": "德国",
        "year": "1922",
        "description": "机械线条与鸟形仿佛发出无法听见的鸣叫，克利以精确的荒诞拆解技术时代的生命感。"
    },
    {
        "id": "x06", "file": "Suprematist Composition - Kazimir Malevich.jpg", "periodId": "expressionism-beyond",
        "titleZh": "至上主义构成", "titleEn": "Suprematist Composition",
        "artistId": "malevich", "artistNameZh": "卡济米尔·马列维奇", "artistNameEn": "Kazimir Malevich",
        "artistBorn": 1879, "artistDied": 1935, "nationality": "俄国",
        "year": "1916",
        "description": "几何形体在浅色空间中漂浮，马列维奇让抽象形状获得宇宙般的失重与自足秩序。"
    },
    {
        "id": "u01", "file": "Grant Wood - American Gothic - Google Art Project.jpg", "periodId": "american-modern",
        "titleZh": "美国哥特式", "titleEn": "American Gothic",
        "artistId": "wood", "artistNameZh": "格兰特·伍德", "artistNameEn": "Grant Wood",
        "artistBorn": 1891, "artistDied": 1942, "nationality": "美国",
        "year": "1930",
        "description": "农夫与女儿站在哥特式木屋前，格兰特·伍德以精确写实塑造美国乡村的坚毅与矛盾神话。"
    },
    {
        "id": "u02", "file": "NY Met demuth figure 5 gold.JPG", "periodId": "american-modern",
        "titleZh": "我看见金色的数字5", "titleEn": "I Saw the Figure 5 in Gold",
        "artistId": "demuth", "artistNameZh": "查尔斯·德穆思", "artistNameEn": "Charles Demuth",
        "artistBorn": 1883, "artistDied": 1935, "nationality": "美国",
        "year": "1928",
        "description": "大写的金色数字5在红黑背景中反复闪回，德穆思把精确主义与城市速度合成视觉诗。"
    },
    {
        "id": "u03", "file": "Portrait of a German Officer, Marsden Hartley.jpg", "periodId": "american-modern",
        "titleZh": "德国军官肖像", "titleEn": "Portrait of a German Officer",
        "artistId": "hartley", "artistNameZh": "马斯登·哈特利", "artistNameEn": "Marsden Hartley",
        "artistBorn": 1877, "artistDied": 1943, "nationality": "美国",
        "year": "1914",
        "description": "军徽、数字与色块拼成抽象纪念像，哈特利把个人哀悼与第一次世界大战记忆藏进军事符号。"
    },
    {
        "id": "u04", "file": "Goin' Fishin', by Arthur G. Dove.jpg", "periodId": "american-modern",
        "titleZh": "去钓鱼", "titleEn": "Goin' Fishin'",
        "artistId": "dove", "artistNameZh": "阿瑟·德夫", "artistNameEn": "Arthur Dove",
        "artistBorn": 1880, "artistDied": 1946, "nationality": "美国",
        "year": "1925",
        "description": "蜿蜒形状与自然色块抽象出湖岸和鱼竿的节奏，德夫证明美国抽象可以来自土地经验而非欧洲理论。"
    },
    {
        "id": "u05", "file": "John Marin Lower Manhattan, 1920.jpg", "periodId": "american-modern",
        "titleZh": "下曼哈顿", "titleEn": "Lower Manhattan",
        "artistId": "marin", "artistNameZh": "约翰·马林", "artistNameEn": "John Marin",
        "artistBorn": 1870, "artistDied": 1953, "nationality": "美国",
        "year": "1922",
        "description": "摩天楼、桥梁与河岸被拆成颤动的线条和色面，马林以水彩的能量回应纽约的垂直焦虑。"
    },
    {
        "id": "u06", "file": "Joseph Stella, 1919-20, Brooklyn Bridge, oil on canvas, 215.3 x 194.6 cm, Yale University Art Gallery.jpg", "periodId": "american-modern",
        "titleZh": "布鲁克林大桥", "titleEn": "Brooklyn Bridge",
        "artistId": "stella", "artistNameZh": "约瑟夫·斯特拉", "artistNameEn": "Joseph Stella",
        "artistBorn": 1877, "artistDied": 1946, "nationality": "美国",
        "year": "1939",
        "description": "钢缆、拱券与灯光化为放射状几何，斯特拉把现代桥梁画成美国工业文明的哥特式圣殿。"
    },
    {
        "id": "u07", "file": "Gelmeroda-chapel.jpg", "periodId": "american-modern",
        "titleZh": "格尔梅罗达教堂", "titleEn": "Church of Gelmeroda",
        "artistId": "feininger", "artistNameZh": "莱昂内尔·费宁格", "artistNameEn": "Lyonel Feininger",
        "artistBorn": 1871, "artistDied": 1956, "nationality": "美国",
        "year": "1930",
        "description": "透明色面与尖塔交叠成光的棱镜，费宁格把哥特结构、立体主义和抒情抽象融合为现代光的建筑。"
    },
]


def http_get(url, timeout=45, max_attempts=4):
    last_error = None
    for attempt in range(max_attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code not in (429, 500, 502, 503, 504):
                raise
            wait = max(2.0, min(16, 2 ** attempt))
            retry_after = exc.headers.get("Retry-After")
            if retry_after:
                try:
                    wait = max(wait, float(retry_after))
                except ValueError:
                    pass
            wait = min(wait, 30)
            print(f"  HTTP {exc.code}; retrying in {wait:.1f}s...", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt >= 5:
                break
            wait = max(1.0, 2 ** attempt)
            print(f"  Network error; retrying in {wait:.1f}s...", flush=True)
            time.sleep(wait)
    raise last_error


def api_get(params):
    params["format"] = "json"
    params["action"] = "query"
    query = urllib.parse.urlencode(params)
    return json.loads(http_get(API + "?" + query).decode("utf-8"))


def media_search(query):
    url = ("https://commons.wikimedia.org/w/index.php?"
           + urllib.parse.urlencode({"search": query, "title": "Special:MediaSearch", "type": "image"}))
    raw = http_get(url, timeout=60).decode("utf-8", "replace")
    candidates = []
    for token in re.findall(r'File:[^"\s]{0,180}', raw):
        if "\\u0026" in token:
            token = token.split("\\u0026", 1)[0]
        title = html.unescape(urllib.parse.unquote(token)).replace("_", " ")
        lower = title.lower()
        if lower.startswith("file:") and lower.endswith((".jpg", ".jpeg", ".png", ".tif")):
            if title not in candidates:
                candidates.append(title)
    return candidates


def title_page_url(title):
    return "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe=":/()'")


def fetch_imageinfo_by_titles(titles):
    found = {}
    for start in range(0, len(titles), 40):
        chunk = titles[start:start + 40]
        data = api_get({
            "titles": "|".join(chunk),
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata",
            "iiurlwidth": 1400,
        })
        for page in data.get("query", {}).get("pages", {}).values():
            if "imageinfo" in page:
                found[page["title"]] = page["imageinfo"][0]
        time.sleep(0.2)
    return found


def fetch_imageinfo(works):
    return fetch_imageinfo_by_titles(["File:" + w["file"] for w in works])


def resolve_missing(works, info):
    missing = [w for w in works if "File:" + w["file"] not in info]
    if not missing:
        return info, {}
    print("Resolving missing titles via Commons MediaSearch...", flush=True)
    resolved = {}
    for w in missing:
        query = f'{w["titleEn"]} {w["artistNameEn"]}'
        hits = media_search(query)
        if hits:
            resolved[w["id"]] = hits[0]
        time.sleep(0.4)
    print("Resolved:", flush=True)
    for w in missing:
        print("  ", w["id"], w["file"], "->", resolved.get(w["id"], "NOT FOUND"), flush=True)
    extra = fetch_imageinfo_by_titles(list(resolved.values()))
    info.update(extra)
    return info, resolved


def fetch_asset(url, dest):
    raw = http_get(url, timeout=90)
    with open(dest, "wb") as f:
        f.write(raw)
    return len(raw)


def clean_html(value):
    if not value:
        return ""
    return re.sub(r"<[^>]+>", "", value).strip()


def main():
    os.makedirs(ART_DIR, exist_ok=True)
    print(f"Preparing {len(WORKS)} artworks...", flush=True)
    info = fetch_imageinfo(WORKS)
    info, resolved_titles = resolve_missing(WORKS, info)
    actual_titles = {w["id"]: "File:" + w["file"] for w in WORKS}
    actual_titles.update(resolved_titles)

    missing = [w for w in WORKS if actual_titles[w["id"]] not in info]
    if missing:
        print("MISSING FILES:")
        for w in missing:
            print(" -", w["id"], w["file"])

    artists = {}
    artworks = []
    failed = 0

    for w in WORKS:
        key = actual_titles[w["id"]]
        meta = info.get(key)
        if not meta:
            failed += 1
            continue
        dest = os.path.join(ART_DIR, w["id"] + ".jpg")
        url = meta.get("thumburl") or meta.get("url")
        if not os.path.exists(dest):
            try:
                size = fetch_asset(url, dest)
                print(f"  downloaded {w['id']} {size // 1024} KB", flush=True)
                time.sleep(1.2)
            except Exception as exc:
                print(f"  FAILED {w['id']}: {exc}")
                failed += 1
                continue

        ext = meta.get("extmetadata", {})
        license_name = clean_html(ext.get("LicenseShortName", {}).get("value", "Public domain"))
        license_url = clean_html(ext.get("LicenseUrl", {}).get("value", ""))
        artist_credit = clean_html(ext.get("Artist", {}).get("value", w["artistNameEn"]))
        page_url = title_page_url(key)
        artists[w["artistId"]] = {
            "id": w["artistId"],
            "name": w["artistNameZh"],
            "nameEn": w["artistNameEn"],
            "birthYear": w["artistBorn"],
            "deathYear": w["artistDied"],
            "nationality": w["nationality"],
        }
        artworks.append({
            "id": w["id"],
            "title": w["titleZh"],
            "titleEn": w["titleEn"],
            "artistId": w["artistId"],
            "periodId": w["periodId"],
            "year": w["year"],
            "description": w["description"],
            "image": "/assets/art/" + w["id"] + ".jpg",
            "originalWidth": int(meta.get("width") or 0),
            "originalHeight": int(meta.get("height") or 0),
            "imageWidth": int(meta.get("thumbwidth") or 0),
            "imageHeight": int(meta.get("thumbheight") or 0),
            "source": page_url,
            "filePage": page_url,
            "downloadUrl": meta.get("descriptionurl") or url,
            "license": license_name,
            "licenseUrl": license_url,
            "commonsArtistCredit": artist_credit,
        })

    if failed:
        print(f"{failed} artwork(s) failed; fix filenames before building.")
        sys.exit(1)

    manifest = {
        "project": {
            "name": "时光画廊",
            "nameEn": "Time Gallery",
            "version": "1.0.0",
            "description": "沉浸式艺术史科普游戏，从《Arts and Ideas》的宏观脉络出发，以第一人称3D画廊串联十二个艺术时期与八十幅公有领域经典画作。",
            "defaultLang": "zh-CN",
            "runtime": "fully-offline",
        },
        "academicReference": {
            "coreTexts": [
                "Fleming, William & Marien, Mary Warner. Arts and Ideas. Thomson/Wadsworth, later editions.",
                "以艺术形式背后的意识形态、社会背景与时代精神作为分期与叙述框架。"
            ],
            "note": "本项目为科普教育用途，文本为编者按学术框架撰写的原创简释，不含对原书内容的直接复制。"
        },
        "periods": PERIODS,
        "artists": list(artists.values()),
        "artworks": artworks,
        "licensing": {
            "policy": "全部图像来自 Wikimedia Commons，均为公有领域（Public Domain）或 CC0 授权。",
            "notice": "授权信息以各文件页面为准；本清单在构建时从 Commons 元数据记录。",
            "assets": "图片仅用于本地教育展示，随项目离线打包。"
        },
        "network": "运行时零外部请求；所有脚本、样式、字体与图片均随 dist 本地打包。",
    }

    manifest_path = os.path.join(ROOT, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest written: {len(artworks)} artworks, {len(artists)} artists.")


if __name__ == "__main__":
    main()
