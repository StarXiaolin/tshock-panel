'use strict';

/**
 * tshock/config.json 的中文说明表。
 * 每一项 [键名, 中文名, 说明]，界面按类型自动生成开关 / 数字 / 文本 / 下拉 / 颜色控件。
 */

const GROUPS = [
  {
    id: 'basic',
    title: '基础与连接',
    desc: '服务器对外显示的端口、人数和聊天格式。',
    items: [
      ['ServerName', '服务器名称', '在服务器列表里显示的名称，需要同时开启“使用自定义服务器名”。'],
      ['UseServerName', '使用自定义服务器名', '开启后客户端看到的服务器名会替换为上面的名称。'],
      ['ServerPort', '服务器端口', '玩家连接使用的端口，默认 7777。修改后需重启，并在防火墙/路由器放行。'],
      ['ServerPassword', '服务器密码', '进入服务器需要输入的密码，留空表示无密码。'],
      ['MaxSlots', '最大玩家数', '可同时在线的人数上限（不含预留槽位）。'],
      ['ReservedSlots', '预留槽位', '为有权限的玩家额外保留的槽位数量。'],
      ['LogPath', '日志目录', 'TShock 自身日志的保存目录，面板控制台不依赖它。'],
      ['DebugLogs', '调试日志', '输出更多内部调试信息，排查问题时才需要开启。'],
      ['DisableLoginBeforeJoin', '连接完成前禁止登录', '防止玩家在还没连上服务器时就发送登录请求。'],
      ['IgnoreChestStacksOnLoad', '忽略箱子堆叠限制', '加载世界时允许箱子里超过堆叠上限的物品。'],
      ['CommandSpecifier', '命令前缀', '聊天里触发命令的符号，默认 /。'],
      ['CommandSilentSpecifier', '静默命令前缀', '静默执行命令的符号，默认 .。'],
      ['MaximumChatMessageLength', '聊天最大长度', '单条聊天允许的最大字符数，超出会被截断或拒绝。'],
      ['TruncateExcessiveChatMessages', '截断超长聊天', '开启后超长聊天会被截断，而不是直接拒绝发送。'],
      ['ChatFormat', '聊天格式', '普通聊天的显示格式，{1} 玩家名 {2} 后缀 {3} 前缀 {4} 内容。'],
      ['EnableChatAboveHeads', '头顶显示聊天', '在玩家头顶显示其聊天内容。'],
      ['ChatAboveHeadsFormat', '头顶聊天格式', '头顶聊天的显示格式。'],
      ['SuperAdminChatPrefix', '管理员聊天前缀', '超级管理员发言时显示在名字前的内容。'],
      ['SuperAdminChatSuffix', '管理员聊天后缀', '超级管理员发言时显示在名字后的内容。'],
      ['SuperAdminChatRGB', '管理员颜色', '超级管理员聊天的 RGB 颜色。'],
      ['BroadcastRGB', '广播颜色', '服务器广播消息的 RGB 颜色。'],
      ['DisableSpewLogs', '关闭刷屏日志', '减少刷屏类日志的输出，让日志更好读。'],
      ['DisableSecondUpdateLogs', '关闭二次更新日志', '减少每秒更新的冗余日志。'],
      ['EnableGeoIP', '启用 GeoIP', '根据 IP 解析玩家所在地区（需要 GeoIP.dat）。'],
      ['DisplayIPToAdmins', '向管理员显示 IP', '有权限的管理员可以看到玩家 IP。'],
    ],
  },
  {
    id: 'world',
    title: '世界与存档',
    desc: '自动存档、备份间隔等与存档安全相关的设置。',
    items: [
      ['WorldTileProvider', '图格提供器', '世界图格数据的实现方式，默认 constileation，一般不要改。'],
      ['AutoSave', '自动存档', '定期把世界写回磁盘，强烈建议保持开启。'],
      ['AnnounceSave', '公告存档', '每次存档时在游戏内提示玩家。'],
      ['ShowBackupAutosaveMessages', '显示备份提示', '存档备份时在控制台输出提示信息。'],
      ['BackupInterval', '备份间隔（分钟）', '每隔多少分钟做一次世界备份，0 表示不自动备份。'],
      ['BackupKeepFor', '备份保留（分钟）', '自动备份保留多久，超期的会被清理。'],
      ['SaveWorldOnCrash', '崩溃时保存', '服务器异常退出时尽量保存世界，降低回档损失。'],
      ['SaveWorldOnLastPlayerExit', '最后一人退出时保存', '服务器空场时自动保存世界。'],
    ],
  },
  {
    id: 'gameplay',
    title: '玩法规则',
    desc: '刷怪、PvP、出生点保护、地形蔓延等游戏内规则。',
    items: [
      ['InvasionMultiplier', '入侵倍率', '入侵事件（哥布林、海盗等）的强度倍率。'],
      ['DefaultMaximumSpawns', '默认刷怪上限', '每一波同时存在的怪物数量上限。'],
      ['DefaultSpawnRate', '默认刷怪速率', '数值越大刷怪越慢。'],
      ['InfiniteInvasion', '无限入侵', '入侵事件不会结束，需要手动触发。'],
      ['PvPMode', 'PvP 模式', 'normal 普通、always 始终开启、disabled 完全禁用。'],
      ['SpawnProtection', '出生点保护', '保护出生点周围的方块不被破坏。'],
      ['SpawnProtectionRadius', '出生点保护半径', '以出生点为中心的保护半径（图格）。'],
      ['RangeChecks', '距离检测', '检测玩家与其放置方块的距离，用于反作弊。'],
      ['HardcoreOnly', '仅限硬核角色', '只允许硬核角色进入服务器。'],
      ['MediumcoreOnly', '仅限中核角色', '只允许中核角色进入服务器。'],
      ['SoftcoreOnly', '仅限软核角色', '只允许软核角色进入服务器。'],
      ['DisableBuild', '禁止建造', '普通玩家无法放置或破坏方块。'],
      ['DisableHardmode', '禁止困难模式', '无法进入困难模式，肉山后也不会触发。'],
      ['DisableDungeonGuardian', '禁用地牢守卫', '关闭地牢守卫的生成。'],
      ['DisableClownBombs', '禁用小丑炸弹', '防止小丑炸毁地形。'],
      ['DisableSnowBalls', '禁用雪球', '关闭雪球造成的伤害与效果。'],
      ['DisableTombstones', '禁用墓碑', '玩家死亡后不再掉落墓碑。'],
      ['DisablePrimeBombs', '禁用机械骷髅炸弹', '防止机械骷髅王的炸弹破坏地形。'],
      ['ForceTime', '强制时间', 'normal 正常、day 白天、night 夜晚。'],
      ['DisableInvisPvP', 'PvP 时禁止隐身', '开启 PvP 时隐身药水不再让对方看不见你。'],
      ['MaxRangeForDisabled', '被禁用玩家的移动半径', '被 /disable 的玩家可移动的最大距离（图格）。'],
      ['RegionProtectChests', '区域保护箱子', '区域保护是否同时保护箱子。'],
      ['RegionProtectGemLocks', '区域保护宝石锁', '区域保护是否同时保护宝石锁。'],
      ['IgnoreProjUpdate', '忽略弹幕更新', '跳过部分弹幕更新逻辑，减少卡顿但可能影响判定。'],
      ['IgnoreProjKill', '忽略弹幕销毁', '跳过部分弹幕销毁逻辑。'],
      ['AllowCutTilesAndBreakables', '允许剪断藤蔓', '允许玩家剪断藤蔓、破坏可破坏物。'],
      ['AllowIce', '允许冰块转化', '允许冰在特定条件下转化为水或雪。'],
      ['AllowCrimsonCreep', '允许猩红蔓延', '允许猩红之地自然蔓延。'],
      ['AllowCorruptionCreep', '允许腐化蔓延', '允许腐化之地自然蔓延。'],
      ['AllowHallowCreep', '允许神圣蔓延', '允许神圣之地自然蔓延。'],
      ['StatueSpawn200', '雕像刷怪（200 格）', '玩家 200 格内雕像的刷怪数量上限。'],
      ['StatueSpawn600', '雕像刷怪（600 格）', '玩家 600 格内雕像的刷怪数量上限。'],
      ['StatueSpawnWorld', '雕像刷怪（全图）', '整个世界的雕像刷怪数量上限。'],
      ['PreventBannedItemSpawn', '阻止禁用物品产生', '被禁用的物品无法再被生成或拾取。'],
      ['PreventDeadModification', '阻止死亡修改', '死亡状态下无法修改世界。'],
      ['PreventInvalidPlaceStyle', '阻止无效放置样式', '阻止客户端发送非法的方块放置样式。'],
      ['ForceXmas', '强制圣诞节', '所有时间都按圣诞节活动处理。'],
      ['ForceHalloween', '强制万圣节', '所有时间都按万圣节活动处理。'],
      ['AllowAllowedGroupsToSpawnBannedItems', '允许授权组生成禁用物品', '有权限的组仍然可以生成被禁用的物品。'],
      ['RespawnSeconds', '复活时间（秒）', '普通死亡后的复活等待秒数，0 表示使用默认。'],
      ['RespawnBossSeconds', 'Boss 战复活时间（秒）', 'Boss 战期间死亡的复活等待秒数。'],
      ['AnonymousBossInvasions', '匿名 Boss 入侵', '入侵消息中不显示触发玩家的名字。'],
      ['MaxHP', '最大生命', '玩家生命上限。'],
      ['MaxMP', '最大魔力', '玩家魔力上限。'],
      ['BombExplosionRadius', '爆炸半径', '炸弹类物品的爆炸半径。'],
      ['GiveItemsDirectly', '直接给予物品', '新玩家出生时直接拿到物品而不是掉在地上。'],
    ],
  },
  {
    id: 'account',
    title: '账号与登录',
    desc: '注册、登录、白名单、死亡惩罚等账号相关规则。',
    items: [
      ['DefaultRegistrationGroupName', '默认注册组', '新注册玩家自动加入的权限组。'],
      ['DefaultGuestGroupName', '默认游客组', '未登录玩家使用的权限组。'],
      ['RememberLeavePos', '记住离开位置', '玩家重新进服时回到上次离开的位置。'],
      ['MaximumLoginAttempts', '最大登录尝试', '连续输错密码多少次后断开连接。'],
      ['KickOnMediumcoreDeath', '中核死亡踢出', '中核角色死亡后把玩家踢出服务器。'],
      ['MediumcoreKickReason', '中核踢出原因', '踢出时显示给玩家的原因。'],
      ['BanOnMediumcoreDeath', '中核死亡封禁', '中核角色死亡后自动封禁。'],
      ['MediumcoreBanReason', '中核封禁原因', '封禁时记录的原因。'],
      ['DisableDefaultIPBan', '禁用默认 IP 封禁', '封禁时不再同时封禁 IP 地址。'],
      ['EnableWhitelist', '启用白名单', '只有白名单内的玩家可以进入。'],
      ['WhitelistKickReason', '白名单踢出原因', '不在白名单时显示给玩家的原因。'],
      ['ServerFullReason', '服务器已满提示', '人数已满时显示给玩家的原因。'],
      ['ServerFullNoReservedReason', '服务器满员提示（含预留）', '连预留槽位也满时显示的提示。'],
      ['KickOnHardcoreDeath', '硬核死亡踢出', '硬核角色死亡后把玩家踢出服务器。'],
      ['HardcoreKickReason', '硬核踢出原因', '踢出时显示的原因。'],
      ['BanOnHardcoreDeath', '硬核死亡封禁', '硬核角色死亡后自动封禁。'],
      ['HardcoreBanReason', '硬核封禁原因', '封禁时记录的原因。'],
      ['KickProxyUsers', '踢出代理用户', '拒绝通过代理连接的玩家。'],
      ['RequireLogin', '必须登录', '关闭后玩家不登录也能以游客身份进入。'],
      ['AllowLoginAnyUsername', '允许任意用户名登录', '关闭只允许已注册的账号登录。'],
      ['AllowRegisterAnyUsername', '允许任意用户名注册', '关闭后注册名必须与角色名一致。'],
      ['MinimumPasswordLength', '最小密码长度', '注册和修改密码时的最小长度。'],
      ['BCryptWorkFactor', 'BCrypt 强度', '密码哈希强度，越大越安全但登录越慢。'],
      ['DisableUUIDLogin', '禁用 UUID 自动登录', '对公开服务器建议开启，避免 UUID 被冒用。'],
      ['KickEmptyUUID', '踢出空 UUID', '拒绝没有 UUID 的客户端。'],
    ],
  },
  {
    id: 'anticheat',
    title: '反作弊阈值',
    desc: '当玩家行为超过阈值时的处理方式，数值过小会误伤正常玩家。',
    items: [
      ['TilePaintThreshold', '涂色阈值', '统计周期内允许的涂色方块数量。'],
      ['KickOnTilePaintThresholdBroken', '涂色超限踢出', '超过涂色阈值时直接踢出玩家。'],
      ['MaxDamage', '最大伤害', '允许单次造成的最大伤害值。'],
      ['MaxProjDamage', '最大弹幕伤害', '弹幕单次造成的最大伤害值。'],
      ['KickOnDamageThresholdBroken', '伤害超限踢出', '超过伤害阈值时踢出玩家。'],
      ['TileKillThreshold', '挖方块阈值', '统计周期内允许挖掉的方块数量。'],
      ['KickOnTileKillThresholdBroken', '挖方块超限踢出', '超过阈值时踢出玩家。'],
      ['TilePlaceThreshold', '放置方块阈值', '统计周期内允许放置的方块数量。'],
      ['KickOnTilePlaceThresholdBroken', '放置超限踢出', '超过阈值时踢出玩家。'],
      ['TileLiquidThreshold', '液体阈值', '统计周期内允许操作的液体格数。'],
      ['KickOnTileLiquidThresholdBroken', '液体超限踢出', '超过阈值时踢出玩家。'],
      ['ProjIgnoreShrapnel', '忽略碎片弹幕', '统计弹幕时不计算碎片类弹幕。'],
      ['ProjectileThreshold', '弹幕阈值', '统计周期内允许产生的弹幕数量。'],
      ['KickOnProjectileThresholdBroken', '弹幕超限踢出', '超过阈值时踢出玩家。'],
      ['HealOtherThreshold', '治疗他人阈值', '统计周期内允许治疗他人的点数。'],
      ['KickOnHealOtherThresholdBroken', '治疗超限踢出', '超过阈值时踢出玩家。'],
      ['SuppressPermissionFailureNotices', '屏蔽权限失败提示', '没有权限执行命令时不再提示玩家。'],
      ['DisableModifiedZenith', '禁用改版天顶剑', '阻止使用被修改过的天顶剑。'],
      ['DisableCustomDeathMessages', '禁用自定义死亡消息', '关闭玩家自定义的死亡提示语。'],
    ],
  },
  {
    id: 'storage',
    title: '数据库',
    desc: '账号、封禁等数据的存储方式，切换数据库需谨慎。',
    items: [
      ['StorageType', '存储类型', 'sqlite 本地文件数据库，mysql 需要外部数据库服务。'],
      ['SqliteDBPath', 'SQLite 文件路径', '相对路径基于服务器目录，默认 tshock.sqlite。'],
      ['SqliteConnectionString', 'SQLite 连接字符串', '一般留空，填写后会覆盖上面的路径设置。'],
      ['MySqlHost', 'MySQL 地址', '格式为 主机:端口。'],
      ['MySqlDbName', 'MySQL 数据库名', '需要事先创建好的数据库。'],
      ['MySqlUsername', 'MySQL 用户名', '连接数据库使用的账号。'],
      ['MySqlPassword', 'MySQL 密码', '连接数据库使用的密码。'],
      ['MySqlConnectionString', 'MySQL 连接字符串', '填写后覆盖上面的分项配置。'],
      ['PostgresHost', 'PostgreSQL 地址', '格式为 主机:端口。'],
      ['PostgresDbName', 'PostgreSQL 数据库名', '需要事先创建好的数据库。'],
      ['PostgresUsername', 'PostgreSQL 用户名', '连接数据库使用的账号。'],
      ['PostgresPassword', 'PostgreSQL 密码', '连接数据库使用的密码。'],
      ['PostgresConnectionString', 'PostgreSQL 连接字符串', '填写后覆盖上面的分项配置。'],
      ['UseSqlLogs', '日志写入数据库', '把日志也写进数据库，查询方便但会增加写入量。'],
      ['RevertToTextLogsOnSqlFailures', 'SQL 日志失败回退次数', '数据库日志连续失败多少次后改回文本日志。'],
    ],
  },
  {
    id: 'rest',
    title: 'REST 接口',
    desc: '面板依赖 REST 接口获取玩家列表并发送控制台命令，一般保持开启即可。',
    items: [
      ['RestApiEnabled', '启用 REST 接口', '关闭后本面板将无法读取在线玩家或执行命令。'],
      ['RestApiPort', 'REST 端口', 'REST 服务监听的端口，面板默认使用 7878。'],
      ['LogRest', '记录 REST 请求日志', '把收到的 REST 请求写进日志，调试时使用。'],
      ['EnableTokenEndpointAuthentication', '启用 Token 端点认证', '通过 /token/create 发放临时令牌，面板不需要。'],
      ['RESTMaximumRequestsPerInterval', '每区间最大请求数', '限流参数，防止 REST 被高频调用。'],
      ['RESTRequestBucketDecreaseIntervalMinutes', '令牌桶恢复间隔（分钟）', '限流令牌的恢复周期。'],
    ],
  },
];

/** 下拉框：值必须与 TShock 认可的字符串完全一致。 */
const ENUMS = {
  PvPMode: [
    { value: 'normal', label: '普通（按玩家设置）' },
    { value: 'always', label: '始终开启' },
    { value: 'disabled', label: '完全禁用' },
  ],
  ForceTime: [
    { value: 'normal', label: '正常' },
    { value: 'day', label: '白天' },
    { value: 'night', label: '夜晚' },
  ],
  StorageType: [
    { value: 'sqlite', label: 'SQLite（本地文件）' },
    { value: 'mysql', label: 'MySQL' },
  ],
};

const SENSITIVE = new Set([
  'ServerPassword',
  'MySqlPassword',
  'PostgresPassword',
  'SqliteConnectionString',
  'MySqlConnectionString',
  'PostgresConnectionString',
]);

/** 面板自己维护、不在界面上直接展示的字段。 */
const HIDDEN = new Set(['ApplicationRestTokens']);

const LABELS = {};
const HINTS = {};
const ORDER = [];
for (const group of GROUPS) {
  for (const [key, label, hint] of group.items) {
    LABELS[key] = label;
    HINTS[key] = hint;
    ORDER.push(key);
  }
}

const KNOWN = new Set(ORDER);

/** 没有写进说明表的新字段，按“其他”分组展示。 */
function fallbackGroup(settings) {
  const items = Object.keys(settings)
    .filter((key) => !KNOWN.has(key) && !HIDDEN.has(key))
    .map((key) => [key, key, 'TShock 新增的设置项，界面暂未提供中文说明。']);
  if (items.length === 0) return null;
  return {
    id: 'other',
    title: '其他',
    desc: 'TShock 版本新增、本面板尚未收录说明的设置项。',
    items,
  };
}

/** 生成给前端使用的结构。 */
function buildSchema(settings) {
  const groups = GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    desc: group.desc,
    items: group.items.map(([key, label, hint]) => ({ key, label, hint })),
  }));
  const extra = fallbackGroup(settings || {});
  if (extra) {
    groups.push({
      id: extra.id,
      title: extra.title,
      desc: extra.desc,
      items: extra.items.map(([key, label, hint]) => ({ key, label, hint })),
    });
  }
  return {
    groups,
    enums: ENUMS,
    sensitive: [...SENSITIVE],
    hidden: [...HIDDEN],
  };
}

module.exports = { buildSchema, ENUMS, SENSITIVE, HIDDEN, LABELS, HINTS };
