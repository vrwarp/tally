/**
 * What a leader types to find an icon, in Chinese.
 *
 * The picker's haystack has two halves and they want opposite treatment.
 * **Labels are prose** — `Clock`, `Groups`, `Today` — so they live in
 * `messages/*.json` under `EventIcons.*` and are translated like every other
 * string in the app. **Keywords are a search index**, and a bag of words is
 * where a translation pipeline does its worst work: there is no sentence to get
 * right, no register to match, and every extra term is a small win rather than
 * a risk. So they are here, as data, and not in a translator's queue.
 *
 * One bag for both Chinese catalogues rather than two, and that is not a
 * shortcut. Simplified and Traditional are genuinely different vocabularies —
 * which is why `zh-Hant` is a hand-maintained catalogue and never a character
 * conversion of `zh-Hans` — but this is an index, not prose: a leader reading
 * Traditional who types 營 should find the icon, and so should the one who types
 * 营. Both spellings go in both times, and the union is strictly better at the
 * one job this data has.
 *
 * Each bag also carries **pinyin**, syllables and initials — `luying`, `ly` for
 * 露營. The picker is in the main app on a real keyboard, but a leader searching
 * in Chinese would otherwise have to switch IME in the middle of a form. Same
 * romanization the roster search uses; see `functions/src/names/pinyin.ts` for
 * why the dictionary that produced it is not in this bundle.
 *
 * GENERATED, then kept by hand — the same standing as the path data in
 * `eventIcons.ts`. The Chinese was written for this ministry and the pinyin
 * was produced from it once. Adding an icon means adding a line here; missing
 * one costs nothing but a harder search.
 *
 * Never a home for anything user-visible. Nothing here is ever displayed.
 */

export const EVENT_ICON_TERMS: Readonly<Record<string, string>> = {
  event: '活动 活動 日程 日期 行事历 行事曆 huodong hd richeng rc riqi rq xingshili xsl',
  calendar_month: '日历 日曆 月历 月曆 月份 日程 rili rl yueli yl yuefen yf richeng rc',
  today: '今天 今日 当天 當天 日期 jintian jt jinri jr dangtian dt riqi rq',
  schedule: '时间 時間 时钟 時鐘 钟表 鐘錶 小时 小時 shijian sj shizhong sz zhongbiao zb xiaoshi xs',
  groups: '人群 团体 團體 群体 群體 会众 會眾 团契 團契 青年 事工 renqun rq tuanti tt qunti qt huizhong hz tuanqi tq qingnian qn shigong sg',
  group: '小组 小組 团契 團契 朋友 几个人 幾個人 xiaozu xz tuanqi tq pengyou py jigeren jgr',
  diversity_3: '群体 群體 社区 社區 团契 團契 一起 多元 qunti qt shequ sq tuanqi tq yiqi yq duoyuan dy',
  diversity_1: '朋友 好友 团契 團契 圈子 一起 pengyou py haoyou hy tuanqi tq quanzi qz yiqi yq',
  handshake: '握手 欢迎 歡迎 合作 见面 見面 接待 woshou ws huanying hy hezuo hz jianmian jm jiedai jd',
  waving_hand: '招手 挥手 揮手 欢迎 歡迎 你好 新朋友 打招呼 zhaoshou zs huishou hs huanying hy nihao nh xinpengyou xpy dazhaohu dzh',
  child_care: '儿童 兒童 儿童事工 兒童事工 孩子 小孩 幼儿 幼兒 照顾 照顧 主日 ertong et ertongshigong etsg haizi hz xiaohai xh youer ye zhaogu zg zhuri zr',
  kid_star: '孩子 小孩 儿童 兒童 青少年 星星 之星 haizi hz xiaohai xh ertong et qingshaonian qsn xingxing xx zhixing zx',
  crib: '婴儿 嬰兒 婴儿床 嬰兒床 幼儿 幼兒 育婴 育嬰 睡觉 睡覺 yinger ye yingerchuang yec youer yuying yy shuijiao sj shuijue',
  stroller: '婴儿车 嬰兒車 推车 推車 婴儿 嬰兒 幼儿 幼兒 家长 家長 yingerche yec yingerju yej tuiche tc tuiju tj yinger ye youer jiazhang jz jiachang jc',
  high_chair: '幼儿 幼兒 学步 學步 餐椅 高脚椅 高腳椅 喂食 餵食 youer ye xuebu xb canyi cy gaojiaoyi gjy weishi ws',
  baby_changing_station: '尿布 换尿布 換尿布 婴儿 嬰兒 育婴室 育嬰室 更换 更換 niaobu nb huanniaobu hnb yinger ye yuyingshi yys genghuan gh',
  family_restroom: '家庭 一家人 父母 孩子 亲子 親子 jiating jt yijiaren yjr fumu fm haizi hz qinzi qz',
  footprint: '脚印 腳印 足迹 足跡 脚步 腳步 行走 路径 路徑 旅程 孩子 jiaoyin jy zuji zj jiaobu jb xingzou xz lujing lj lvcheng lc haizi hz',
  barefoot: '赤脚 赤腳 脚丫 腳丫 小脚 小腳 婴儿 嬰兒 幼儿 幼兒 沙滩 沙灘 chijiao cj jiaoya jy xiaojiao xj yinger ye youer shatan st',
  celebration: '庆祝 慶祝 派对 派對 彩带 彩帶 欢乐 歡樂 喜庆 喜慶 qingzhu qz paidui pd caidai cd huanle hl xiqing xq',
  festival: '节庆 節慶 园游会 園遊會 嘉年华 嘉年華 帐篷 帳篷 市集 jieqing jq yuanyouhui yyh jianianhua jnh zhangpeng zp shiji sj',
  emoji_events: '奖杯 獎杯 比赛 比賽 得奖 得獎 冠军 冠軍 jiangbei jb bisai bs dejiang dj guanjun gj',
  workspace_premium: '奖章 獎章 徽章 表扬 表揚 荣誉 榮譽 肯定 jiangzhang jz huizhang hz biaoyang by rongyu ry kending kd',
  campaign: '宣布 宣佈 公告 喇叭 广播 廣播 布道 佈道 外展 xuanbu xb gonggao gg laba lb guangbo gb budao bd waizhan wz',
  forum: '讨论 討論 交流 对话 對話 谈话 談話 小组 小組 taolun tl jiaoliu jl duihua dh tanhua th xiaozu xz',
  chat_bubble: '聊天 对话 對話 讯息 訊息 消息 交谈 交談 liaotian lt duihua dh xunxi xx xiaoxi jiaotan jt',
  weekend: '沙发 沙發 客厅 客廳 家里 家裡 接待 小组 小組 shafa sf keting kt jiali jl jiedai jd xiaozu xz',
  table_restaurant: '餐桌 桌子 聚餐 用餐 家里 家裡 团契 團契 小组 小組 canzhuo cz zhuozi zz jucan jc yongcan yc jiali jl tuanqi tq xiaozu xz',
  church: '教会 教會 礼拜 禮拜 崇拜 聚会 聚會 圣殿 聖殿 信仰 基督 耶稣 耶穌 主日 jiaohui jh libai lb chongbai cb juhui shengdian sd xinyang xy jidu jd yesu ys zhuri zr',
  folded_hands: '祷告 禱告 祈祷 祈禱 双手 雙手 敬拜 信仰 基督 耶稣 耶穌 daogao dg qidao qd shuangshou ss jingbai jb xinyang xy jidu jd yesu ys',
  candle: '蜡烛 蠟燭 烛光 燭光 平安夜 圣诞 聖誕 守夜 敬拜 光 lazhu lz zhuguang zg pinganye pay shengdan sd shouye sy jingbai jb guang',
  self_improvement: '安静 安靜 默想 灵修 靈修 反省 静默 靜默 祷告 禱告 敬拜 anjing aj moxiang mx lingxiu lx fanxing fx jingmo jm daogao dg jingbai jb',
  menu_book: '查经 查經 圣经 聖經 读经 讀經 书 書 课程 課程 学习 學習 chajing cj shengjing sj dujing dj shu kecheng kc xuexi xx',
  auto_stories: '灵修 靈修 读经 讀經 书本 書本 故事 圣经 聖經 翻页 翻頁 lingxiu lx dujing dj shuben sb gushi gs shengjing sj fanye fy',
  book_ribbon: '圣经 聖經 经文 經文 书 書 查经 查經 神的话 神的話 shengjing sj jingwen jw shu chajing cj shendehua sdh',
  history_edu: '学习 學習 课 課 教导 教導 上课 上課 读书 讀書 圣经 聖經 xuexi xx ke jiaodao jd shangke sk dushu ds shengjing sj',
  volunteer_activism: '服事 服務 服务 奉献 奉獻 爱心 愛心 关怀 關懷 慈善 双手 雙手 fushi fs fuwu fw fengxian fx aixin ax guanhuai gh cishan cs shuangshou ss',
  favorite: '爱 愛 爱心 愛心 关怀 關懷 喜欢 喜歡 耶稣 耶穌 基督 ai aixin ax guanhuai gh xihuan xh yesu ys jidu jd',
  star: '星星 星 特别 特別 重点 重點 闪亮 閃亮 收藏 xingxing xx xing tebie tb zhongdian zd shanliang sl shoucang sc',
  star_shine: '星星 闪亮 閃亮 发光 發光 光芒 孩子 儿童 兒童 xingxing xx shanliang sl faguang fg guangmang gm haizi hz ertong et',
  stars_2: '星空 星星 夜空 闪烁 閃爍 孩子 儿童 兒童 xingkong xk xingxing xx yekong yk shanshuo ss haizi hz ertong et',
  auto_awesome: '闪亮 閃亮 星光 特别 特別 亮点 亮點 光彩 shanliang sl xingguang xg tebie tb liangdian ld guangcai gc',
  spa: '退修 靜修 静修 休息 安静 安靜 平静 平靜 更新 tuixiu tx jingxiu jx xiuxi xx anjing aj pingjing pj gengxin gx',
  light_mode: '日出 太阳 太陽 早晨 晨曦 光 明亮 崇拜 richu rc taiyang ty zaochen zc chenxi cx guang mingliang ml chongbai cb',
  local_fire_department: '营火 營火 篝火 火 火焰 露营 露營 营会 營會 退修 yinghuo yh gouhuo gh huo huoyan hy luying ly yinghui tuixiu tx',
  camping: '露营 露營 营会 營會 帐篷 帳篷 户外 戶外 夏令营 夏令營 luying ly yinghui yh zhangpeng zp huwai hw xialingying xly',
  holiday_village: '营地 營地 木屋 小屋 村 住宿 退修 营会 營會 yingdi yd muwu mw xiaowu xw cun zhusu zs tuixiu tx yinghui yh',
  chalet: '冬令营 冬令營 山屋 木屋 退修 滑雪 雪 山上 donglingying dly shanwu sw muwu mw tuixiu tx huaxue hx xue shanshang ss',
  cabin: '小屋 木屋 营地 營地 退修 露营 露營 房子 xiaowu xw muwu mw yingdi yd tuixiu tx luying ly fangzi fz',
  forest: '森林 树林 樹林 树 樹 户外 戶外 大自然 营地 營地 senlin sl shulin shu huwai hw daziran dzr yingdi yd',
  park: '公园 公園 树 樹 长椅 長椅 户外 戶外 绿地 綠地 gongyuan gy shu changyi cy huwai hw lvdi ld',
  nature_people: '户外 戶外 大自然 郊游 郊遊 树林 樹林 散步 退修 营会 營會 huwai hw daziran dzr jiaoyou jy shulin sl sanbu sb tuixiu tx yinghui yh',
  hiking: '健行 爬山 远足 遠足 登山 背包 户外 戶外 步道 jianxing jx pashan ps yuanzu yz dengshan ds beibao bb huwai hw budao bd',
  directions_walk: '走路 步行 散步 脚步 腳步 祷告 禱告 路径 路徑 旅程 zoulu zl buxing bx sanbu sb jiaobu jb daogao dg lujing lj lvcheng lc',
  landscape: '山 山景 群山 风景 風景 户外 戶外 郊外 地形 shan shanjing sj qunshan qs fengjing fj huwai hw jiaowai jw dixing dx',
  nights_stay: '过夜 過夜 夜晚 月亮 通宵 留宿 guoye gy yewan yw yueliang yl tongxiao tx liusu ls',
  bedtime: '通宵 月亮 夜晚 过夜 過夜 留宿 睡觉 睡覺 tongxiao tx yueliang yl yewan yw guoye gy liusu ls shuijiao sj shuijue',
  moon_stars: '星空 夜晚 月亮 星星 过夜 過夜 通宵 露营 露營 xingkong xk yewan yw yueliang yl xingxing xx guoye gy tongxiao tx luying ly',
  beach_access: '海滩 海灘 沙滩 沙灘 太阳 太陽 阳伞 陽傘 夏天 夏令 haitan ht shatan st taiyang ty yangsan ys xiatian xt xialing xl',
  pool: '游泳 泳池 水 夏天 夏令 玩水 youyong yy yongchi yc shui xiatian xt xialing xl wanshui ws',
  sailing: '帆船 船 湖 水上 划船 fanchuan fc chuan hu shuishang ss huachuan hc',
  kayaking: '独木舟 獨木舟 皮划艇 划船 桨 槳 河 水上 dumuzhou dmz pihuating pht huachuan hc jiang he shuishang ss',
  ac_unit: '冬天 雪 雪花 寒冷 冬令 滑雪 dongtian dt xue xuehua xh hanleng hl dongling dl huaxue hx',
  sports_basketball: '篮球 籃球 球 运动 運動 球赛 球賽 球场 球場 lanqiu lq qiu yundong yd qiusai qs qiuchang qc',
  sports_soccer: '足球 球 运动 運動 球赛 球賽 球场 球場 zuqiu zq qiu yundong yd qiusai qs qiuchang qc',
  sports_volleyball: '排球 球 运动 運動 球赛 球賽 网 網 paiqiu pq qiu yundong yd qiusai qs wang',
  sports_football: '橄榄球 橄欖球 美式足球 球 运动 運動 ganlanqiu glq meishizuqiu mszq qiu yundong yd',
  directions_run: '跑步 赛跑 賽跑 运动 運動 活动 活動 paobu pb saipao sp yundong yd huodong hd',
  fitness_center: '健身 重训 重訓 运动 運動 举重 舉重 体能 體能 jianshen js zhongxun zx yundong yd juzhong jz tineng tn',
  skateboarding: '滑板 溜滑板 运动 運動 极限 極限 huaban hb liuhuaban lhb yundong yd jixian jx',
  sports_esports: '电玩 電玩 电子游戏 電子遊戲 手把 遊戲 游戏 电竞 電競 dianwan dw dianziyouxi dzyx shouba sb youxi yx dianjing dj',
  casino: '桌游 桌遊 骰子 游戏 遊戲 游戏之夜 遊戲之夜 玩 zhuoyou zy touzi tz youxi yx youxizhiye yxzy wan',
  toys_and_games: '游戏 遊戲 玩具 玩 孩子 儿童 兒童 活动 活動 好玩 youxi yx wanju wj wan haizi hz ertong et huodong hd haowan hw',
  extension: '拼图 拼圖 活动 活動 游戏 遊戲 手作 一块 一塊 pintu pt huodong hd youxi yx shouzuo sz yikuai yk',
  restaurant: '吃饭 吃飯 用餐 晚餐 餐 刀叉 食物 聚餐 chifan cf yongcan yc wancan wc can daocha dc shiwu sw jucan jc',
  dining: '聚餐 爱宴 愛宴 一人一菜 盘子 盤子 晚餐 食物 jucan jc aiyan ay yirenyicai yryc panzi pz wancan wc shiwu sw',
  local_pizza: '披萨 披薩 比萨 比薩 食物 晚餐 pisa ps bisa bs shiwu sw wancan wc',
  lunch_dining: '午餐 汉堡 漢堡 食物 野餐 烤肉 wucan wc hanbao hb shiwu sw yecan yc kaorou kr',
  dinner_dining: '晚餐 晚饭 晚飯 食物 用餐 傍晚 wancan wc wanfan wf shiwu sw yongcan yc bangwan bw',
  breakfast_dining: '早餐 早饭 早飯 鸡蛋 雞蛋 早晨 食物 zaocan zc zaofan zf jidan jd zaochen shiwu sw',
  brunch_dining: '早午餐 早餐 午餐 食物 用餐 zaowucan zwc zaocan zc wucan wc shiwu sw yongcan yc',
  soup_kitchen: '供餐 派饭 派飯 汤 湯 服事 外展 慈善 义工 義工 食物 gongcan gc paifan pf tang fushi fs waizhan wz cishan cs yigong yg shiwu sw',
  bakery_dining: '面包 麵包 糕点 糕點 可颂 可頌 早餐 点心 點心 mianbao mb gaodian gd kesong ks zaocan zc dianxin dx',
  cookie: '点心 點心 饼干 餅乾 零食 甜点 甜點 小吃 dianxin dx binggan bg bingqian bq lingshi ls tiandian td xiaochi xc',
  icecream: '冰淇淋 雪糕 甜点 甜點 夏天 甜筒 bingqilin bql xuegao xg tiandian td xiatian xt tiantong tt',
  cake: '蛋糕 生日 庆生 慶生 甜点 甜點 派对 派對 dangao dg shengri sr qingsheng qs tiandian td paidui pd',
  local_cafe: '咖啡 咖啡厅 咖啡廳 热饮 熱飲 杯 团契 團契 点心 點心 kafei kf kafeiting kft reyin ry bei tuanqi tq dianxin dx',
  local_drink: '饮料 飲料 喝 水 果汁 茶点 茶點 杯 yinliao yl he shui guozhi gz chadian cd bei',
  outdoor_grill: '烤肉 烧烤 燒烤 户外 戶外 食物 野炊 kaorou kr shaokao sk huwai hw shiwu sw yechui yc',
  directions_bus: '巴士 公车 公車 游览车 遊覽車 交通 出游 出遊 车 車 bashi bs gongche gc gongju gj youlanche ylc youlanju ylj jiaotong jt chuyou cy che ju',
  flight: '短宣 宣教 飞机 飛機 出国 出國 机场 機場 旅行 duanxuan dx xuanjiao xj feiji fj chuguo cg jichang jc lvxing lx',
  luggage: '行李 旅行 出游 出遊 打包 行李箱 xingli xl lvxing lx chuyou cy dabao db xinglixiang xlx',
  map: '地图 地圖 路线 路線 位置 方向 旅行 ditu dt luxian lx weizhi wz fangxiang fx lvxing',
  explore: '探索 指南针 指南針 冒险 冒險 发现 發現 tansuo ts zhinanzhen znz maoxian mx faxian fx',
  local_activity: '活动 活動 门票 門票 出游 出遊 节目 節目 huodong hd menpiao mp chuyou cy jiemu jm',
  attractions: '好玩 游乐 遊樂 活动 活動 园游会 園遊會 出游 出遊 haowan hw youle yl huodong hd yuanyouhui yyh chuyou cy',
  music_note: '诗歌 詩歌 音乐 音樂 敬拜 赞美 讚美 唱歌 乐团 樂團 shige sg yinyue yy yinle yl jingbai jb zanmei zm changge cg yuetuan yt letuan lt',
  piano: '钢琴 鋼琴 键盘 鍵盤 敬拜 乐团 樂團 音乐 音樂 赞美 讚美 gangqin gq jianpan jp jingbai jb yuetuan yt letuan lt yinyue yy yinle yl zanmei zm',
  library_music: '诗歌 詩歌 歌曲 音乐 音樂 敬拜 赞美 讚美 专辑 專輯 shige sg gequ gq yinyue yy yinle yl jingbai jb zanmei zm zhuanji zj',
  mic: '麦克风 麥克風 咪 讲道 講道 唱歌 声音 聲音 敬拜 讲员 講員 maikefeng mkf mi jiangdao jd changge cg shengyin sy jingbai jb jiangyuan jy',
  headphones: '耳机 耳機 音乐 音樂 收听 收聽 声音 聲音 erji ej yinyue yy yinle yl shouting st shengyin sy',
  theater_comedy: '戏剧 戲劇 话剧 話劇 表演 演出 面具 xiju xj huaju hj biaoyan by yanchu yc mianju mj',
  palette: '手工 手作 美劳 美勞 画画 畫畫 颜色 顏色 艺术 藝術 创作 創作 shougong sg shouzuo sz meilao ml huahua hh yanse ys yishu chuangzuo cz',
  movie: '电影 電影 影片 看电影 看電影 电影之夜 電影之夜 dianying dy yingpian yp kandianying kdy dianyingzhiye dyzy',
  photo_camera: '照片 相机 相機 拍照 摄影 攝影 zhaopian zp xiangji xj paizhao pz sheying sy',
  school: '主日学 主日學 上课 上課 教导 教導 学校 學校 毕业 畢業 儿童 兒童 青少年 zhurixue zrx shangke sk jiaodao jd xuexiao xx biye by ertong et qingshaonian qsn',
  backpack: '开学 開學 书包 書包 背包 学生 學生 青少年 儿童 兒童 营会 營會 kaixue kx shubao sb beibao bb xuesheng xs qingshaonian qsn ertong et yinghui yh',
  science: '科学 科學 实验 實驗 烧杯 燒杯 实验室 實驗室 kexue kx shiyan sy shaobei sb shiyanshi sys',
  psychology: '辅导 輔導 陪伴 心理 思考 引导 引導 门徒 門徒 fudao fd peiban pb xinli xl sikao sk yindao yd mentu mt',
  cleaning_services: '打扫 打掃 清洁 清潔 整理 服事 工作天 dasao ds qingjie qj zhengli zl fushi fs gongzuotian gzt',
  recycling: '回收 环保 環保 服务 服務 服事 环境 環境 huishou hs huanbao hb fuwu fw fushi fs huanjing hj',
  medical_services: '急救 医疗 醫療 药箱 藥箱 健康 医药 醫藥 jijiu jj yiliao yl yaoxiang yx jiankang jk yiyao yy',
  featured_seasonal_and_gifts: '交换礼物 交換禮物 礼物 禮物 送礼 送禮 卡片 jiaohuanliwu jhlw liwu lw songli sl kapian kp',
  redeem: '圣诞 聖誕 礼物 禮物 礼物盒 禮物盒 送礼 送禮 shengdan sd liwu lw liwuhe lwh songli sl',
};
