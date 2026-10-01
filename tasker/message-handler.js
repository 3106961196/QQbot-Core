import { normalizeError } from './utils.js'

export class MessageHandler {
  constructor(tasker) {
    this._tasker = tasker
    this.messageBuilder = null
  }

  get config() { return this._tasker.config }
  get sep() { return this._tasker.sep }
  get bind_user() { return this._tasker.bind_user }

  setMessageBuilder(builder) {
    this.messageBuilder = builder
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          AgentRuntime.makeLog('debug', `发送: ${this.messageBuilder.makeLog(i)}`, data.self_id)
          const ret = await send(i)
          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
        } catch (err) {
          AgentRuntime.makeLog('error', `发送失败: ${normalizeError(err).message}`, data.self_id, err)
          rets.error.push(err)
          return false
        }
      }
    }

    const mdMode = this.config?.markdown?.[data.self_id]
    if (mdMode) {
      if (mdMode === "raw") {
        msgs = await this.messageBuilder.makeRawMarkdownMsg(data, msg)
      } else {
        msgs = await this.messageBuilder.makeMarkdownMsg(data, msg)
      }
    } else {
      msgs = await this.messageBuilder.makeMsg(data, msg)
    }

    if (await sendMsg() === false) {
      msgs = await this.messageBuilder.makeMsg(data, msg)
      await sendMsg()
    }

    if (Array.isArray(data._ret_id)) data._ret_id.push(...rets.message_id)
    return rets
  }

  sendFriendMsg(data, msg, event) {
    return this.sendMsg(
      data,
      m => data.bot.sdk.sendPrivateMessage(data.user_id, m, event),
      msg,
    )
  }

  sendGroupMsg(data, msg, event) {
    return this.sendMsg(
      data,
      m => data.bot.sdk.sendGroupMessage(data.group_id, m, event),
      msg,
    )
  }

  async sendGMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    const msgs = await this.messageBuilder.makeGuildMsg(data, msg)

    for (const i of msgs) {
      try {
        AgentRuntime.makeLog('debug', `发送消息: ${this.messageBuilder.makeLog(i)}`, data.self_id)
        const ret = await send(i)
        AgentRuntime.makeLog('debug', `发送消息返回: ${AgentRuntime.String(ret)}`, data.self_id)
        rets.data.push(ret)
        if (ret.id) rets.message_id.push(ret.id)
      } catch (err) {
        AgentRuntime.makeLog('error', `发送消息错误: ${normalizeError(err).message}`, data.self_id, err)
        rets.error.push(err)
      }
    }
    return rets
  }

  async sendDirectMsg(data, msg) {
    if (!data.guild_id) {
      if (!data.src_guild_id) {
        AgentRuntime.makeLog('error', `发送频道私聊消息失败：[${data.user_id}] 不存在来源频道信息`, data.self_id)
        return false
      }
      const dms = await data.bot.sdk.createDirectSession(data.src_guild_id, data.user_id)
      data.guild_id = dms.guild_id
      data.channel_id = dms.channel_id
      data.bot.fl.set(`qg_${data.user_id}`, { ...data.bot.fl.get(`qg_${data.user_id}`), ...dms })
    }
    return this.sendGMsg(data, msg => data.bot.sdk.sendDirectMessage(data.guild_id, msg), msg)
  }

  sendGuildMsg(data, msg) {
    return this.sendGMsg(data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg), msg)
  }

  async recallMsg(data, recall, message_id) {
    if (!Array.isArray(message_id)) message_id = [message_id]
    const msgs = []
    for (const id of message_id) {
      try {
        msgs.push(await recall(id))
      } catch (err) {
        AgentRuntime.makeLog('debug', `撤回消息错误: ${id}`, data.self_id, err)
        msgs.push(false)
      }
    }
    return msgs
  }

  recallFriendMsg(data, message_id) {
    AgentRuntime.makeLog('info', `撤回好友消息：[${data.user_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallFriendMessage(data.user_id, id), message_id)
  }

  recallGroupMsg(data, message_id) {
    AgentRuntime.makeLog('info', `撤回群消息：[${data.group_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallGroupMessage(data.group_id, id), message_id)
  }

  recallDirectMsg(data, message_id, hide = this.config.hideGuildRecall) {
    AgentRuntime.makeLog('info', `撤回${hide ? "并隐藏" : ""}频道私聊消息：[${data.guild_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallDirectMessage(data.guild_id, id, hide), message_id)
  }

  recallGuildMsg(data, message_id, hide = this.config.hideGuildRecall) {
    AgentRuntime.makeLog('info', `撤回${hide ? "并隐藏" : ""}频道消息：[${data.channel_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallGuildMessage(data.channel_id, id, hide), message_id)
  }

  pickFriend(id, user_id) {
    if (typeof user_id !== "string") user_id = String(user_id)
    else if (user_id.startsWith("qg_")) return this.pickGuildFriend(id, user_id)

    const i = {
      ...AgentRuntime[id].fl.get(user_id),
      self_id: id,
      bot: AgentRuntime[id],
      user_id: user_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      recallMsg: message_id => this.recallFriendMsg(i, message_id),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`,
    }
  }

  pickMember(id, group_id, user_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    if (typeof user_id !== "string") user_id = String(user_id)
    else if (user_id.startsWith("qg_")) return this.pickGuildMember(id, group_id, user_id)

    const i = {
      ...AgentRuntime[id].fl.get(user_id),
      ...AgentRuntime[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: AgentRuntime[id],
      user_id: user_id.replace(`${id}${this.sep}`, ""),
      group_id: group_id.replace(`${id}${this.sep}`, ""),
    }
    return { ...this.pickFriend(id, user_id), ...i }
  }

  pickGroup(id, group_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    else if (group_id.startsWith("qg_")) return this.pickGuild(id, group_id)

    const i = {
      ...AgentRuntime[id].gl.get(group_id),
      self_id: id,
      bot: AgentRuntime[id],
      group_id: group_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      recallMsg: message_id => this.recallGroupMsg(i, message_id),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
    }
  }

  pickGuildFriend(id, user_id) {
    const i = {
      ...AgentRuntime[id].fl.get(user_id),
      self_id: id,
      bot: AgentRuntime[id],
      user_id: user_id.replace(/^qg_/, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide),
    }
  }

  pickGuildMember(id, group_id, user_id) {
    const guild_id = group_id.replace(/^qg_/, "").split("-")
    const i = {
      ...AgentRuntime[id].fl.get(user_id),
      ...AgentRuntime[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: AgentRuntime[id],
      src_guild_id: guild_id[0],
      src_channel_id: guild_id[1],
      user_id: user_id.replace(/^qg_/, ""),
    }
    return {
      ...this.pickGuildFriend(id, user_id),
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide),
    }
  }

  pickGuild(id, group_id) {
    const guild_id = group_id.replace(/^qg_/, "").split("-")
    const i = {
      ...AgentRuntime[id].gl.get(group_id),
      self_id: id,
      bot: AgentRuntime[id],
      guild_id: guild_id[0],
      channel_id: guild_id[1],
    }
    return {
      ...i,
      sendMsg: msg => this.sendGuildMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallGuildMsg(i, message_id, hide),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
    }
  }

  async makeFriendMessage(data, event) {
    data.sender = { user_id: `${data.self_id}${this.sep}${event.sender.user_id}` }
    AgentRuntime.makeLog('info', `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.sender.user_id }, msg, { id: data.message_id })
    this.setFriendMap(data)
  }

  async makeGroupMessage(data, event) {
    data.sender = { user_id: `${data.self_id}${this.sep}${event.sender.user_id}` }
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    AgentRuntime.makeLog('info', `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
    // 仅「被 @ 机器人」的群消息才补 at 段，避免插件误判。
    // 判定优先级：
    //  1. SDK 在 mentions 被删前挂的 _isAtBot（全量模式 GROUP_MESSAGE_CREATE
    //     下 @ 与非 @ 共用事件名，只能靠 mentions 区分）
    //  2. 事件名回落：GROUP_AT_MESSAGE_CREATE（@ 模式）视为被 @；
    //     旧事件（无 _raw_event）保持原有行为（兼容历史）
    const isAt = event._isAtBot
      ?? (event._raw_event ? event._raw_event === 'GROUP_AT_MESSAGE_CREATE' : true)
    if (isAt) {
      data.message.unshift({ type: 'at', qq: data.self_id })
    }
    this.setGroupMap(data)
  }

  async makeDirectMessage(data, event) {
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      avatar: event.author.avatar,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
      src_guild_id: event.src_guild_id,
    }
    AgentRuntime.makeLog('info', `频道私聊消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendDirectMsg({
      ...data,
      user_id: event.user_id,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    }, msg, { id: data.message_id })
    this.setFriendMap(data)
  }

  async makeGuildMessage(data, event) {
    data.message_type = "group"
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      card: event.member.nick,
      avatar: event.author.avatar,
      src_guild_id: event.guild_id,
      src_channel_id: event.channel_id,
    }
    data.group_id = `qg_${event.guild_id}-${event.channel_id}`
    AgentRuntime.makeLog('info', `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGuildMsg({
      ...data,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    }, msg, { id: data.message_id })
    this.setFriendMap(data)
    this.setGroupMap(data)
  }

  setFriendMap(data) {
    if (!data.user_id) return
    data.bot.fl.set(data.user_id, { ...data.bot.fl.get(data.user_id), ...data.sender })
  }

  setGroupMap(data) {
    if (!data.group_id) return
    data.bot.gl.set(data.group_id, { ...data.bot.gl.get(data.group_id), group_id: data.group_id })
    let gml = data.bot.gml.get(data.group_id)
    if (!gml) {
      gml = new Map()
      data.bot.gml.set(data.group_id, gml)
    }
    gml.set(data.user_id, { ...gml.get(data.user_id), ...data.sender })
  }

  async makeMessage(id, event) {
    const data = {
      raw: event,
      bot: AgentRuntime[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      event_id: event.message_id,  // R6：稳定事件键，供底层 markProcessed 去重（SDK DISPATCH 重放防护）

      get user_id() { return this.sender.user_id },
      message: event.message,
      raw_message: event.raw_message,
      tasker: 'qqbot',
      isQQBot: true,
    }

    for (const i of data.message) {
      if (i.type === "at") {
        if (data.message_type === "group") i.qq = `${data.self_id}${this.sep}${i.user_id}`
        else i.qq = `qg_${i.user_id}`
      }
    }

    switch (data.message_type) {
      case "private":
        if (data.sub_type === "friend") await this.makeFriendMessage(data, event)
        else await this.makeDirectMessage(data, event)
        break
      case "group":
        await this.makeGroupMessage(data, event)
        break
      case "guild":
        await this.makeGuildMessage(data, event)
        break
      default:
        AgentRuntime.makeLog('warn', `未知消息类型: ${AgentRuntime.String(event)}`, id)
        return
    }

    AgentRuntime.em(`qqbot.${data.post_type}`, data)
  }

  async makeBotCallback(id, event, callback) {
    const data = {
      raw: event,
      bot: AgentRuntime[callback.self_id],
      self_id: callback.self_id,
      post_type: "message",
      message_id: event.event_id ? `event_${event.event_id}` : event.notice_id,
      message_type: callback.group_id ? "group" : "private",
      sub_type: "callback",
      get user_id() { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: "",
      tasker: 'qqbot',
      isQQBot: true,
    }

    data.message.push({ type: "at", qq: callback.self_id }, { type: "text", text: callback.message })
    data.raw_message += callback.message

    if (callback.group_id) {
      data.group_id = callback.group_id
      data.group = data.bot.pickGroup(callback.group_id)
      data.group_name = data.group.name
      data.friend = AgentRuntime[id].pickFriend(data.user_id)
      if (data.friend.real_id) {
        data.friend = data.bot.pickFriend(data.friend.real_id)
        data.member = data.group.pickMember(data.friend.user_id)
        data.sender = { ...await data.member.getInfo() || data.member }
      } else {
        if (AgentRuntime[id].callback[data.user_id]) return event.reply(3)
        AgentRuntime[id].callback[data.user_id] = true
        let msg = `请先发送 #QQBot绑定用户${data.user_id}`
        const real_id = callback.message.replace(/^#[Qq]+[Bb]ot绑定用户确认/, "").trim()
        if (this.bind_user[real_id] === data.user_id) {
          await AgentRuntime[id].fl.set(data.user_id, { ...AgentRuntime[id].fl.get(data.user_id), real_id })
          msg = `绑定成功 ${data.user_id} → ${real_id}`
        }
        event.reply(0)
        return data.group.sendMsg(msg)
      }
      AgentRuntime.makeLog('info', `群按钮点击事件：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    } else {
      await AgentRuntime[id].fl.set(data.user_id, { ...AgentRuntime[id].fl.get(data.user_id), real_id: callback.user_id })
      data.friend = data.bot.pickFriend(callback.user_id)
      data.sender = { ...await data.friend.getInfo() || data.friend }
      AgentRuntime.makeLog('info', `好友按钮点击事件：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    }

    event.reply(0)
    AgentRuntime.em(`qqbot.${data.post_type}`, data)
  }

  async makeCallback(id, event) {
    const reply = event.reply.bind(event)
    event.reply = async (...args) => {
      try {
        return await reply(...args)
      } catch (err) {
        AgentRuntime.makeLog('debug', `回复按钮点击事件错误`, id, err)
      }
    }

    const scene = event.notice_type
    // R4：SDK notice_type（friend/group/guild）统一为 OneBot 语义
    // （friend→private，guild→group，与 makeGuildMessage 的改写一致），
    // 避免 switch fallthrough 到 default 被静默丢弃
    const message_type = scene === 'friend' ? 'private' : scene === 'guild' ? 'group' : 'group'

    const data = {
      raw: event,
      bot: AgentRuntime[id],
      self_id: id,
      post_type: "message",
      message_id: event.event_id ? `event_${event.event_id}` : event.notice_id,
      event_id: event.event_id ? `event_${event.event_id}` : event.notice_id,  // R6：稳定事件键（去重）
      message_type,
      sub_type: "callback",
      get user_id() { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: "",
      tasker: 'qqbot',
      isQQBot: true,
    }

    const callback = data.bot.callback[event.data?.resolved?.button_id]
    if (callback) {
      if (callback.self_id) return this.makeBotCallback(id, event, callback)
      if (!event.group_id && callback.group_id) event.group_id = callback.group_id
      data.message_id = callback.id
      if (callback.message_id.length) {
        for (const id of callback.message_id) data.message.push({ type: "reply", id })
        data.raw_message += `[回复：${callback.message_id}]`
      }
      data.message.push({ type: "text", text: callback.message })
      data.raw_message += callback.message
    } else {
      if (event.data?.resolved?.button_id) {
        data.message.push({ type: "reply", id: event.data?.resolved?.button_id })
        data.raw_message += `[回复：${event.data?.resolved?.button_id}]`
      }
      if (event.data?.resolved?.button_data) {
        data.message.push({ type: "text", text: event.data?.resolved?.button_data })
        data.raw_message += event.data?.resolved?.button_data
      } else {
        event.reply(1)
      }
    }
    event.reply(0)

    switch (data.message_type) {
      case "private":
        AgentRuntime.makeLog('info', `好友按钮点击事件：[${data.user_id}] ${data.raw_message}`, data.self_id)
        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.operator_id }, msg, { id: data.message_id })
        await this.setFriendMap(data)
        break
      case "group":
        // R4：guild 回调（频道按钮）与 QQ 群统一走 group 语义，group_id 用 qg_ 前缀（与 makeGuildMessage 一致）
        if (scene === 'guild') {
          data.group_id = `qg_${event.guild_id}-${event.channel_id}`
          data.src_guild_id = event.guild_id
          data.src_channel_id = event.channel_id
          AgentRuntime.makeLog('info', `频道按钮点击事件：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
          data.reply = msg => this.sendGuildMsg({
            ...data,
            guild_id: event.guild_id,
            channel_id: event.channel_id,
          }, msg, { id: data.message_id })
          await this.setGroupMap(data)
        } else {
          data.group_id = `${id}${this.sep}${event.group_id}`
          AgentRuntime.makeLog('info', `群按钮点击事件：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
          data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
          await this.setGroupMap(data)
        }
        break
      default:
        AgentRuntime.makeLog('warn', `未知按钮点击事件: ${AgentRuntime.String(event)}`, data.self_id)
    }

    AgentRuntime.em(`qqbot.${data.post_type}`, data)
  }

  /**
   * R5：SDK notice 事件 → OneBot 风格结构化字段。
   * key = `${notice_type}.${sub_type}`（guild 的 member.* 已带 member 前缀）。
   * 值 = [notice_event 名, 需要补的语义字段]
   */
  static NOTICE_MAP = {
    'friend.increase':        ['friend_add',    ['user_id']],
    'friend.decrease':        ['friend_del',    ['user_id']],
    'friend.receive_open':    ['friend_receive',['user_id']],
    'friend.receive_close':   ['friend_receive',['user_id']],
    'group.increase':         ['group_increase',['group_id', 'operator_id']],
    'group.decrease':         ['group_decrease',['group_id', 'operator_id']],
    'group.receive_open':     ['group_receive', ['group_id', 'operator_id']],
    'group.receive_close':    ['group_receive', ['group_id', 'operator_id']],
    'guild.increase':         ['guild_create',  ['guild_id', 'operator_id']],
    'guild.update':           ['guild_update',  ['guild_id', 'operator_id']],
    'guild.decrease':         ['guild_delete',  ['guild_id', 'operator_id']],
    'guild.member.increase':  ['group_member_increase', ['guild_id', 'user_id', 'operator_id']],
    'guild.member.update':    ['group_member_update',   ['guild_id', 'user_id', 'operator_id']],
    'guild.member.decrease':  ['group_member_decrease', ['guild_id', 'user_id', 'operator_id']],
    'channel.increase':       ['channel_create',['guild_id', 'channel_id', 'operator_id']],
    'channel.update':         ['channel_update',['guild_id', 'channel_id', 'operator_id']],
    'channel.decrease':       ['channel_delete',['guild_id', 'channel_id', 'operator_id']],
    'channel.enter':          ['channel_enter', ['guild_id', 'channel_id', 'operator_id']],
    'channel.exit':           ['channel_exit',  ['guild_id', 'channel_id', 'operator_id']],
  }

  async makeNotice(id, event) {
    const data = {
      raw: event,
      bot: AgentRuntime[id],
      self_id: id,
      post_type: event.post_type,
      notice_type: event.notice_type,
      notice_id: event.notice_id,
      event_id: event.notice_id || event.event_id,  // R6：稳定事件键（去重）
      sub_type: event.sub_type,
      tasker: 'qqbot',
      isQQBot: true,
    }

    // action（按钮回调）走 callback 路径
    if (data.sub_type === 'action') {
      data.message_type = event.notice_type === 'friend' ? 'private' : 'group'
      return this.makeCallback(id, event)
    }

    // R5：结构化映射 + 语义字段
    const entry = MessageHandler.NOTICE_MAP[`${data.notice_type}.${data.sub_type}`]
    if (entry) {
      data.notice_event = entry[0]
      const fields = entry[1]
      for (const f of fields) {
        if (event[f] !== undefined) data[f] = event[f]
        else if (event[f.replace('_id', '_openid')] !== undefined) data[f] = event[f.replace('_id', '_openid')]
        // R5：guild.member.* 的 user 在 event.user.id（SDK GuildMemberChangeNoticeEvent）
        else if (f === 'user_id' && event.user?.id !== undefined) data[f] = event.user.id
      }
      if (data.notice_type === 'group' && data.group_id !== undefined) {
        data.group_id = `${id}${this.sep}${data.group_id}`
      }
      AgentRuntime.makeLog('info', `通知: [${data.notice_event}] ${data.notice_id}`, id)
    } else {
      AgentRuntime.makeLog('warn', `未知通知: ${AgentRuntime.String(event)}`, id)
    }

    AgentRuntime.em(`qqbot.${data.post_type}`, data)
  }
}
