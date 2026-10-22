'use strict';

/**
 * 权限节点目录（取自 TShock 6.2.1 TShockAPI.dll 中的实际字面量，共 179 个），
 * 以及世界事件的中文标签、所需权限映射。
 *
 * 注意：这里只用于“界面上给管理员挑选/参考”，真正是否放行由 TShock 自己判断。
 */

const PERMISSION_GROUPS = [
  {
    id: 'item',
    title: '物品',
    items: [
      ['tshock.item.give', '给予他人物品（/give）'],
      ['tshock.item.spawn', '给自己生成物品（/item）'],
      ['tshock.item.usebanned', '使用被禁用的物品'],
      ['tshock.admin.itemban', '管理物品禁用列表'],
      ['tshock.ignore.dropbanneditem', '丢弃被禁物品不报错'],
      ['tshock.ignore.itemstack', '忽略物品堆叠检查'],
    ],
  },
  {
    id: 'events',
    title: '世界事件',
    items: [
      ['tshock.world.events', '使用 /worldevent 命令'],
      ['tshock.world.events.meteor', '触发陨石'],
      ['tshock.world.events.fullmoon', '触发满月'],
      ['tshock.world.events.bloodmoon', '触发血月'],
      ['tshock.world.events.eclipse', '触发日食'],
      ['tshock.world.events.invasion', '触发入侵'],
      ['tshock.world.events.sandstorm', '触发沙尘暴'],
      ['tshock.world.events.rain', '触发下雨 / 史莱姆雨 / 钱币雨'],
      ['tshock.world.events.lanternsnight', '触发灯笼夜'],
      ['tshock.world.events.meteorshower', '触发流星雨'],
    ],
  },
  {
    id: 'world',
    title: '世界与时间',
    items: [
      ['tshock.world.modify', '修改世界方块'],
      ['tshock.world.paint', '涂色'],
      ['tshock.world.movenpc', '移动 NPC'],
      ['tshock.world.info', '查看世界信息'],
      ['tshock.world.save', '保存世界'],
      ['tshock.world.settleliquids', '静止液体'],
      ['tshock.world.editspawn', '修改出生点'],
      ['tshock.world.setspawn', '设置出生点'],
      ['tshock.world.time.set', '设置时间'],
      ['tshock.world.time.bloodmoon', '切换血月（旧命令）'],
      ['tshock.world.time.eclipse', '切换日食（旧命令）'],
      ['tshock.world.time.fullmoon', '切换满月（旧命令）'],
      ['tshock.world.time.dropmeteor', '召唤陨石（旧命令）'],
      ['tshock.world.time.*', '时间的全部操作'],
      ['tshock.world.rain', '切换下雨'],
      ['tshock.world.sandstorm', '切换沙尘暴'],
      ['tshock.world.wind', '调整风力'],
      ['tshock.world.hardmode', '开启困难模式'],
      ['tshock.world.converthardmode', '转换困难模式'],
      ['tshock.world.grow', '种植/生长'],
      ['tshock.world.growevil', '种植邪恶生物群落'],
      ['tshock.world.switchevil', '切换腐化/猩红'],
      ['tshock.world.toggleexpert', '切换专家模式'],
      ['tshock.world.toggleparty', '切换派对'],
      ['tshock.world.setdungeon', '设置地牢'],
      ['tshock.world.sethalloween', '设置万圣节'],
      ['tshock.world.setxmas', '设置圣诞节'],
      ['tshock.world.worldupgrades', '世界升级'],
      ['tshock.world.*', '世界相关的全部权限（含事件）'],
      ['tshock.world.editregion', '编辑区域'],
    ],
  },
  {
    id: 'account',
    title: '账号',
    items: [
      ['tshock.account.register', '注册账号'],
      ['tshock.account.login', '登录'],
      ['tshock.account.logout', '登出'],
      ['tshock.account.changepassword', '修改自己的密码'],
      ['tshock.accountinfo.check', '查询账号是否注册（/accountinfo）'],
      ['tshock.accountinfo.details', '查看账号详情（注册时间、最后 IP）'],
      ['tshock.admin.userinfo', '查看玩家详细信息（/userinfo）'],
      ['tshock.superadmin.user', '操作超级管理员账号'],
      ['tshock.admin.group', '管理用户组（/group）'],
      ['tshock.admin.tempgroup', '临时修改玩家组'],
      ['tshock.ssc.upload', '上传自己的服务端角色'],
      ['tshock.ssc.upload.others', '上传他人的服务端角色'],
      ['tshock.admin.savessi', '保存 SSC 数据'],
      ['tshock.ignore.ssc', '忽略 SSC 校验'],
    ],
  },
  {
    id: 'moderation',
    title: '管理与封禁',
    items: [
      ['tshock.admin.ban', '封禁玩家'],
      ['tshock.admin.noban', '不会被封禁'],
      ['tshock.admin.kick', '踢出玩家'],
      ['tshock.admin.nokick', '不会被踢出'],
      ['tshock.admin.mute', '禁言'],
      ['tshock.admin.broadcast', '全服广播'],
      ['tshock.admin.warp', '管理传送点'],
      ['tshock.admin.region', '管理区域保护'],
      ['tshock.admin.tileban', '管理方块禁用'],
      ['tshock.admin.projectileban', '管理弹幕禁用'],
      ['tshock.admin.viewlogs', '查看日志'],
      ['tshock.admin.antibuild', '忽略建造检查'],
      ['tshock.admin.seeplayerids', '查看玩家 ID'],
      ['tshock.tiles.usebanned', '使用被禁方块'],
      ['tshock.projectiles.usebanned', '使用被禁弹幕'],
      ['tshock.cfg.*', '配置文件的全部权限'],
      ['tshock.cfg.maintenance', '维护模式'],
      ['tshock.cfg.whitelist', '管理白名单'],
      ['tshock.cfg.password', '修改服务器密码'],
      ['tshock.cfg.reload', '重载配置'],
      ['tshock.cfg.createdumps', '导出调试信息'],
    ],
  },
  {
    id: 'tp',
    title: '传送',
    items: [
      ['tshock.tp.self', '传送到自己'],
      ['tshock.tp.pos', '按坐标传送'],
      ['tshock.tp.others', '传送他人'],
      ['tshock.tp.allothers', '传送所有人'],
      ['tshock.tp.home', '/home'],
      ['tshock.tp.spawn', '/spawn'],
      ['tshock.tp.npc', '传送到 NPC'],
      ['tshock.tp.block', '传送方块'],
      ['tshock.tp.silent', '静默传送'],
      ['tshock.tp.override', '无视传送限制'],
      ['tshock.tp.getpos', '读取坐标'],
      ['tshock.tp.rod', '使用混沌传送杖'],
      ['tshock.tp.pylon', '使用晶塔'],
      ['tshock.tp.magicconch', '使用魔法海螺'],
      ['tshock.tp.demonconch', '使用恶魔海螺'],
      ['tshock.tp.wormhole', '使用虫洞药水'],
      ['tshock.tp.tppotion', '使用传送药水'],
    ],
  },
  {
    id: 'npc',
    title: 'NPC 与刷怪',
    items: [
      ['tshock.npc.spawnboss', '生成 Boss'],
      ['tshock.npc.spawnmob', '生成怪物'],
      ['tshock.npc.summonboss', '召唤 Boss'],
      ['tshock.npc.butcher', '清除怪物'],
      ['tshock.npc.invade', '触发入侵（旧命令）'],
      ['tshock.npc.startinvasion', '开始入侵'],
      ['tshock.npc.spawnrate', '调整刷怪速率'],
      ['tshock.npc.maxspawns', '调整刷怪上限'],
      ['tshock.npc.rename', '重命名 NPC'],
      ['tshock.npc.spawnpets', '生成宠物'],
      ['tshock.npc.startdd2', '开始撒旦军队'],
      ['tshock.npc.clearanglerquests', '清空渔夫任务'],
      ['tshock.npc.hurttown', '攻击城镇 NPC'],
      ['tshock.buff.self', '给自己加 Buff'],
      ['tshock.buff.others', '给他人加 Buff'],
      ['tshock.ignore.npcbuff', '忽略 NPC Buff 限制'],
    ],
  },
  {
    id: 'player',
    title: '玩家状态',
    items: [
      ['tshock.godmode', '上帝模式'],
      ['tshock.godmode.other', '给他人上帝模式'],
      ['tshock.heal', '治疗'],
      ['tshock.kill', '杀死玩家'],
      ['tshock.slap', '拍飞玩家'],
      ['tshock.respawn', '重生'],
      ['tshock.respawn.other', '强制他人重生'],
      ['tshock.clear', '清理'],
      ['tshock.su', '切换为超级管理员'],
      ['tshock.info', '查看服务器信息'],
      ['tshock.whisper', '私聊'],
      ['tshock.canchat', '允许聊天'],
      ['tshock.partychat', '队伍聊天'],
      ['tshock.sendemoji', '发送表情'],
      ['tshock.annoy', '烦人模式'],
      ['tshock.reservedslot', '预留槽位'],
      ['tshock.synclocalarea', '同步本地区域'],
      ['tshock.thirdperson', '第三人称'],
      ['tshock.warp', '使用传送点'],
      ['tshock.journey.godmode', '旅程模式上帝'],
      ['tshock.journey.research', '旅程模式研究'],
      ['tshock.journey.setdifficulty', '旅程模式难度'],
      ['tshock.journey.setspawnrate', '旅程模式刷怪速率'],
      ['tshock.journey.time.set', '旅程模式时间'],
      ['tshock.journey.time.freeze', '冻结时间'],
      ['tshock.journey.time.setspeed', '时间流速'],
      ['tshock.journey.rain.strength', '旅程模式雨量'],
      ['tshock.journey.rain.freeze', '冻结下雨'],
      ['tshock.journey.wind.strength', '旅程模式风力'],
      ['tshock.journey.wind.freeze', '冻结风力'],
      ['tshock.journey.biomespreadfreeze', '冻结生物群落蔓延'],
      ['tshock.journey.placementrange', '放置范围'],
    ],
  },
  {
    id: 'bypass',
    title: '反作弊豁免',
    items: [
      ['tshock.ignore.damage', '忽略伤害检查'],
      ['tshock.ignore.hp', '忽略生命检查'],
      ['tshock.ignore.mp', '忽略魔力检查'],
      ['tshock.ignore.projectile', '忽略弹幕检查'],
      ['tshock.ignore.placetile', '忽略放置检查'],
      ['tshock.ignore.removetile', '忽略拆除检查'],
      ['tshock.ignore.liquid', '忽略液体检查'],
      ['tshock.ignore.paint', '忽略涂色检查'],
      ['tshock.ignore.sendtilesquare', '忽略方块更新检查'],
      ['tshock.ignore.resizechests', '忽略箱子扩容检查'],
    ],
  },
  {
    id: 'rest',
    title: 'REST 接口',
    items: [
      ['tshock.rest.useapi', '使用 REST 接口'],
      ['tshock.rest.command', '执行服务器命令'],
      ['tshock.rest.viewips', '查看玩家 IP'],
      ['tshock.rest.manage', '管理服务器'],
      ['tshock.rest.maintenance', '维护操作'],
      ['tshock.rest.broadcast', '广播'],
      ['tshock.rest.kick', '踢出'],
      ['tshock.rest.kill', '杀死'],
      ['tshock.rest.mute', '禁言'],
      ['tshock.rest.butcher', '清理怪物'],
      ['tshock.rest.ban', '封禁'],
      ['tshock.rest.causeevents', '触发事件'],
      ['tshock.rest.cfg', '读取/修改配置'],
      ['tshock.rest.groups.view', '查看用户组'],
      ['tshock.rest.groups.manage', '管理用户组'],
      ['tshock.rest.users.view', '查看用户'],
      ['tshock.rest.users.info', '查看用户信息'],
      ['tshock.rest.users.manage', '管理用户'],
      ['tshock.rest.bans.view', '查看封禁'],
      ['tshock.rest.bans.manage', '管理封禁'],
    ],
  },
];

/** 世界事件：中文名 + 需要的权限节点（节点取自 TShockAPI.dll 实际字面量）。 */
const EVENT_META = {
  meteor: { label: '陨石', desc: '立刻有一颗陨石落地', icon: '☄' },
  fullmoon: { label: '满月', desc: '把今晚设为满月', icon: '🌕' },
  bloodmoon: { label: '血月', desc: '切换血月状态', icon: '🩸' },
  eclipse: { label: '日食', desc: '切换日食状态', icon: '🌑' },
  invasion: { label: '入侵', desc: '开始一场入侵事件', icon: '⚔' },
  sandstorm: { label: '沙尘暴', desc: '触发沙尘暴', icon: '🌪' },
  rain: { label: '下雨', desc: '普通雨 / 史莱姆雨 / 钱币雨', icon: '🌧' },
  lanternsnight: { label: '灯笼夜', desc: '触发灯笼夜', icon: '🏮' },
  meteorshower: { label: '流星雨', desc: '触发流星雨', icon: '✨' },
};

const INVASION_META = {
  goblins: '哥布林入侵',
  snowmen: '雪人军团',
  pirates: '海盗入侵',
  pumpkinmoon: '南瓜月',
  frostmoon: '霜月',
  martians: '火星人入侵',
};

const RAIN_META = {
  slime: '史莱姆雨',
  coin: '钱币雨',
};

/** 没有中文条目时的兜底标签。 */
function eventLabel(type) {
  return (EVENT_META[type] && EVENT_META[type].label) || type;
}

function eventPermission(type) {
  return 'tshock.world.events' + (type ? '.' + type : '');
}

function allPermissionNodes() {
  const set = new Set();
  for (const group of PERMISSION_GROUPS) {
    for (const [node] of group.items) set.add(node);
  }
  return [...set];
}

module.exports = {
  PERMISSION_GROUPS,
  EVENT_META,
  INVASION_META,
  RAIN_META,
  eventLabel,
  eventPermission,
  allPermissionNodes,
};
