export class MessageHandler {
  constructor(tasker) {
    this.tasker = tasker
    this.config = tasker.config
    this.sep = tasker.sep
    this.messageBuilder = null
  }

  setMessageBuilder(builder) {
    this.messageBuilder = builder
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', `发送消息: ${this.messageBuilder.makeLog(i)}`, data.self_id)
          const ret = await send(i)
          Bot.makeLog('debug', `发送消息返回: ${Bot.String(ret)}`, data.self_id)
          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
        } catch (err) {
          Bot.makeLog('error', `发送消息错误: ${err.message}`, data.self_id, err)
          rets.error.push(err)
          return false
        }
      }
    }

    if (this.config.markdown[data.self_id]) {
      if (this.config.markdown[data.self_id] === "raw") {
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
        Bot.makeLog('debug', `发送消息: ${this.messageBuilder.makeLog(i)}`, data.self_id)
        const ret = await send(i)
        Bot.makeLog('debug', `发送消息返回: ${Bot.String(ret)}`, data.self_id)
        rets.data.push(ret)
        if (ret.id) rets.message_id.push(ret.id)
      } catch (err) {
        Bot.makeLog('error', `发送消息错误: ${err.message}`, data.self_id, err)
        rets.error.push(err)
      }
    }
    return rets
  }

  async sendDirectMsg(data, msg) {
    if (!data.guild_id) {
      if (!data.src_guild_id) {
        Bot.makeLog('error', `发送频道私聊消息失败：[${data.user_id}] 不存在来源频道信息`, data.self_id)
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
        Bot.makeLog('debug', `撤回消息错误: ${id}`, data.self_id, err)
        msgs.push(false)
      }
    }
    return msgs
  }

  recallFriendMsg(data, message_id) {
    Bot.makeLog('info', `撤回好友消息：[${data.user_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallFriendMessage(data.user_id, id), message_id)
  }

  recallGroupMsg(data, message_id) {
    Bot.makeLog('info', `撤回群消息：[${data.group_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallGroupMessage(data.group_id, id), message_id)
  }

  recallDirectMsg(data, message_id, hide = this.config.hideGuildRecall) {
    Bot.makeLog('info', `撤回${hide ? "并隐藏" : ""}频道私聊消息：[${data.guild_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallDirectMessage(data.guild_id, id, hide), message_id)
  }

  recallGuildMsg(data, message_id, hide = this.config.hideGuildRecall) {
    Bot.makeLog('info', `撤回${hide ? "并隐藏" : ""}频道消息：[${data.channel_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, id => data.bot.sdk.recallGuildMessage(data.channel_id, id, hide), message_id)
  }

  pickFriend(id, user_id) {
    if (typeof user_id !== "string") user_id = String(user_id)
    else if (user_id.startsWith("qg_")) return this.pickGuildFriend(id, user_id)

    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
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
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, ""),
      group_id: group_id.replace(`${id}${this.sep}`, ""),
    }
    return { ...this.pickFriend(id, user_id), ...i }
  }

  pickGroup(id, group_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    else if (group_id.startsWith("qg_")) return this.pickGuild(id, group_id)

    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
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
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
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
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
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
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
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
    Bot.makeLog('info', `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    Bot.makeLog('debug', `makeFriendMessage: event.sender=${Bot.String(event.sender)}`, data.self_id)
    data.reply = msg => {
      Bot.makeLog('info', `reply called: user_id=${event.sender.user_id}`, data.self_id)
      return this.sendFriendMsg({ ...data, user_id: event.sender.user_id }, msg, { id: data.message_id })
    }
    await this.setFriendMap(data)
  }

  async makeGroupMessage(data, event) {
    data.sender = { user_id: `${data.self_id}${this.sep}${event.sender.user_id}` }
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    Bot.makeLog('info', `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
    data.message.unshift({ type: "at", qq: data.self_id })
    await this.setGroupMap(data)
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
    Bot.makeLog('info', `频道私聊消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendDirectMsg({
      ...data,
      user_id: event.user_id,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    }, msg, { id: data.message_id })
    await this.setFriendMap(data)
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
    Bot.makeLog('info', `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGuildMsg({
      ...data,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    }, msg, { id: data.message_id })
    await this.setFriendMap(data)
    await this.setGroupMap(data)
  }

  async setFriendMap(data) {
    if (!data.user_id) return
    await data.bot.fl.set(data.user_id, { ...data.bot.fl.get(data.user_id), ...data.sender })
  }

  async setGroupMap(data) {
    if (!data.group_id) return
    await data.bot.gl.set(data.group_id, { ...data.bot.gl.get(data.group_id), group_id: data.group_id })
    let gml = data.bot.gml.get(data.group_id)
    if (!gml) {
      gml = new Map()
      await data.bot.gml.set(data.group_id, gml)
    }
    await gml.set(data.user_id, { ...gml.get(data.user_id), ...data.sender })
  }

  async makeMessage(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
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
        Bot.makeLog('warn', `未知消息类型: ${Bot.String(event)}`, id)
        return
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeBotCallback(id, event, callback) {
    const data = {
      raw: event,
      bot: Bot[callback.self_id],
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
      data.friend = Bot[id].pickFriend(data.user_id)
      if (data.friend.real_id) {
        data.friend = data.bot.pickFriend(data.friend.real_id)
        data.member = data.group.pickMember(data.friend.user_id)
        data.sender = { ...await data.member.getInfo() || data.member }
      } else {
        if (Bot[id].callback[data.user_id]) return event.reply(3)
        Bot[id].callback[data.user_id] = true
        let msg = `请先发送 #QQBot绑定用户${data.user_id}`
        const real_id = callback.message.replace(/^#[Qq]+[Bb]ot绑定用户确认/, "").trim()
        if (this.tasker.bind_user[real_id] === data.user_id) {
          await Bot[id].fl.set(data.user_id, { ...Bot[id].fl.get(data.user_id), real_id })
          msg = `绑定成功 ${data.user_id} → ${real_id}`
        }
        event.reply(0)
        return data.group.sendMsg(msg)
      }
      Bot.makeLog('info', `群按钮点击事件：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    } else {
      await Bot[id].fl.set(data.user_id, { ...Bot[id].fl.get(data.user_id), real_id: callback.user_id })
      data.friend = data.bot.pickFriend(callback.user_id)
      data.sender = { ...await data.friend.getInfo() || data.friend }
      Bot.makeLog('info', `好友按钮点击事件：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    }

    event.reply(0)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeCallback(id, event) {
    const reply = event.reply.bind(event)
    event.reply = async (...args) => {
      try {
        return await reply(...args)
      } catch (err) {
        Bot.makeLog('debug', `回复按钮点击事件错误`, id, err)
      }
    }

    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: "message",
      message_id: event.event_id ? `event_${event.event_id}` : event.notice_id,
      message_type: event.notice_type,
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
      case "friend":
        data.message_type = "private"
        Bot.makeLog('info', `好友按钮点击事件：[${data.user_id}] ${data.raw_message}`, data.self_id)
        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.operator_id }, msg, { id: data.message_id })
        await this.setFriendMap(data)
        break
      case "group":
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog('info', `群按钮点击事件：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
        await this.setGroupMap(data)
        break
      case "guild":
        break
      default:
        Bot.makeLog('warn', `未知按钮点击事件: ${Bot.String(event)}`, data.self_id)
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeNotice(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      notice_type: event.notice_type,
      sub_type: event.sub_type,
      notice_id: event.notice_id,
      tasker: 'qqbot',
      isQQBot: true,
    }

    switch (data.sub_type) {
      case "action":
        return this.makeCallback(id, event)
      case "increase":
      case "decrease":
      case "update":
      case "member.increase":
      case "member.decrease":
      case "member.update":
        break
      default:
        Bot.makeLog('warn', `未知通知: ${Bot.String(event)}`, id)
    }
  }
}
