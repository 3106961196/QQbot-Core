import path from "node:path"
import { ulid } from "ulid"
import QRCode from "qrcode"
import imageSize from "image-size"
import urlRegexSafe from "url-regex-safe"
import { encode as encodeSilk, isSilk } from "silk-wasm"

export class MessageBuilder {
  constructor(tasker) {
    this.tasker = tasker
    this.config = tasker.config
    this.toQRCodeRegExp = tasker.toQRCodeRegExp
    this.sharp = tasker.sharp
    this.sep = tasker.sep
  }

  makeLog(msg) {
    return Bot.String(msg).replace(/base64:\/\/.*?(,|]|")/g, "base64://...$1")
  }

  async makeRecord(file) {
    if (this.config.toBotUpload) {
      for (const [id, bot] of this.tasker.bots) {
        if (bot.sdk.uploadRecord) {
          try {
            const url = await bot.sdk.uploadRecord(file)
            if (url) return url
          } catch (err) {
            Bot.makeLog('error', `Bot ${id} 语音上传错误`, 'QQBot', err)
          }
        }
      }
    }

    const buffer = await Bot.Buffer(file)
    if (!Buffer.isBuffer(buffer)) return file
    if (isSilk(buffer)) return buffer

    const convFile = path.join("temp", ulid())
    try {
      const fs = await import("node:fs/promises")
      await fs.writeFile(convFile, buffer)
      await Bot.exec(`ffmpeg -i "${convFile}" -f s16le -ar 48000 -ac 1 "${convFile}.pcm"`)
      file = Buffer.from((await encodeSilk(await fs.readFile(`${convFile}.pcm`), 48000)).data)
    } catch (err) {
      Bot.makeLog('error', 'silk 转码错误', 'QQBot', err)
    }

    for (const i of [convFile, `${convFile}.pcm`]) {
      try {
        const fs = await import("node:fs/promises")
        await fs.unlink(i)
      } catch {}
    }

    return file
  }

  async makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace("data:image/png;base64,", "base64://")
  }

  async makeBotImage(file) {
    if (this.config.toBotUpload) {
      for (const [id, bot] of this.tasker.bots) {
        if (bot.sdk.uploadImage) {
          try {
            const image = await bot.sdk.uploadImage(file)
            if (image.url) return image
          } catch (err) {
            Bot.makeLog('error', `Bot ${id} 图片上传错误`, 'QQBot', err)
          }
        }
      }
    }
  }

  async makeMarkdownImage(data, file, summary = "图片") {
    const buffer = await Bot.Buffer(file)
    const image = await this.makeBotImage(buffer) || { url: await Bot.fileToUrl(file) }

    if (!image.width || !image.height) {
      try {
        const size = imageSize(buffer)
        image.width = size.width
        image.height = size.height
      } catch (err) {
        Bot.makeLog('error', '图片分辨率检测错误', data.self_id, err)
      }
    }

    return {
      des: `![${summary} #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`,
    }
  }

  async compressImage(data, file) {
    if (!this.sharp) return file
    try {
      const size = this.config.imageLength * 1024 * 1024
      const buffer = await Bot.Buffer(file, { http: true })

      if (!Buffer.isBuffer(buffer)) return file
      if (buffer.length <= size) return buffer

      let quality = 105, output
      do {
        quality -= 10
        output = await this.sharp(buffer).jpeg({ quality }).toBuffer()
        Bot.makeLog('debug', `图片压缩完成 ${quality}%(${(output.length / 1024).toFixed(2)}KB)`, data.self_id)
      } while (output.length > size && quality > 10)

      return output
    } catch (err) {
      Bot.makeLog('error', '图片压缩错误', data.self_id, err)
      return file
    }
  }

  makeButton(data, button, style) {
    const msg = {
      id: ulid(),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style,
        ...button.QQBot?.render_data,
      }
    }

    if (button.input) {
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        ...button.QQBot?.action,
      }
    } else if (button.callback) {
      if (this.config.toCallback) {
        msg.action = {
          type: 1,
          permission: { type: 2 },
          ...button.QQBot?.action,
        }
        if (!Array.isArray(data._ret_id)) data._ret_id = []
        data.bot.callback[msg.id] = {
          id: data.message_id,
          user_id: data.user_id,
          group_id: data.group_id,
          message: button.callback,
          message_id: data._ret_id,
        }
        setTimeout(() => delete data.bot.callback[msg.id], 300000)
      } else {
        msg.action = {
          type: 2,
          permission: { type: 2 },
          data: button.callback,
          enter: true,
          ...button.QQBot?.action,
        }
      }
    } else if (button.link) {
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: button.link,
        ...button.QQBot?.action,
      }
    } else {
      return false
    }

    if (button.permission) {
      if (button.permission === "admin") {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission)) button.permission = [button.permission]
        for (const id of button.permission) {
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ""))
        }
      }
    }
    return msg
  }

  makeButtons(data, button_square) {
    const msgs = []
    const random = Math.floor(Math.random() * 2)
    for (const button_row of button_square) {
      const buttons = []
      for (let button of button_row) {
        button = this.makeButton(data, button, (random + msgs.length + buttons.length) % 2)
        if (button) buttons.push(button)
      }
      if (buttons.length) msgs.push({ type: "button", buttons })
    }
    return msgs
  }

  async makeRawMarkdownText(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) {
      for (const url of match) {
        button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        const img = await this.makeMarkdownImage(data, await this.makeQRCode(url), "二维码")
        text = text.replace(url, `${img.des}${img.url}`)
      }
    }
    return text.replace(/@/g, "@​")
  }

  async makeRawMarkdownMsg(data, msg) {
    const messages = []
    const button = []
    let content = ""
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeRecord(i.file)
        case "video":
        case "face":
        case "ark":
        case "embed":
          messages.push([i])
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          content += await this.makeRawMarkdownText(data, `文件：${i.file}`, button)
          break
        case "at":
          if (i.qq === "all") content += "@everyone"
          else content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, "")}>`
          break
        case "text":
          content += await this.makeRawMarkdownText(data, i.text, button)
          break
        case "image": {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary)
          content += `${des}${url}`
          break
        }
        case "markdown":
          if (typeof i.data === "object") messages.push([{ type: "markdown", ...i.data }])
          else content += i.data
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "reply":
          if (i.id.startsWith("event_")) reply = { type: "reply", event_id: i.id.replace(/^event_/, "") }
          else reply = i
          continue
        case "node":
          for (const { message } of i.data) messages.push(...(await this.makeRawMarkdownMsg(data, message)))
          continue
        case "raw":
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        default:
          content += await this.makeRawMarkdownText(data, Bot.String(i), button)
      }
    }

    if (content) messages.unshift([{ type: "markdown", content }])

    if (button.length) {
      for (const i of messages) {
        if (i[0].type === "markdown") i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([{ type: "markdown", content: " " }, ...button.splice(0, 5)])
      }
    }

    if (reply) {
      for (const i in messages) {
        if (Array.isArray(messages[i])) messages[i].unshift(reply)
        else messages[i] = [reply, messages[i]]
      }
    }
    return messages
  }

  async makeMarkdownText_(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) {
      for (const url of match) {
        button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        text = text.replace(url, "[链接(请点击按钮查看)]")
      }
    }
    return text.replace(/\n/g, "\r").replace(/@/g, "@​")
  }

  makeMarkdownText(data, text, content, button) {
    const match = text.match(/!?\[.*?\]\s*\(\w+:\/\/.*?\)/g)
    if (match) {
      const temp = []
      let last = ""
      for (const i of match) {
        const m = i.match(/(!?\[.*?\])\s*(\(\w+:\/\/.*?\))/)
        text = text.split(i)
        temp.push([last + this.makeMarkdownText_(data, text.shift(), button), m[1]])
        text = text.join(i)
        last = m[2]
      }
      temp[0][0] = content + temp[0][0]
      return [last + this.makeMarkdownText_(data, text, button), temp]
    }
    return [this.makeMarkdownText_(data, text, button)]
  }

  makeMarkdownTemplate(data, templates) {
    const msgs = []
    for (const template of templates) {
      if (!template.length) continue
      const params = []
      for (const i in template) {
        params.push({
          key: this.config.markdown.template[i],
          values: [template[i]],
        })
      }
      msgs.push([{
        type: "markdown",
        custom_template_id: this.config.markdown[data.self_id],
        params,
      }])
    }
    return msgs
  }

  makeMarkdownTemplatePush(content, template, templates) {
    for (const i of content) {
      if (template.length === this.config.markdown.template.length - 1) {
        template.push(i.shift())
        template = i
        templates.push(template)
      } else {
        template.push(i.join(""))
      }
    }
    return template
  }

  async makeMarkdownMsg(data, msg) {
    const messages = []
    const button = []
    const templates = [[]]
    let content = ""
    let reply
    let template = templates[0]

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeRecord(i.file)
        case "video":
        case "face":
        case "ark":
        case "embed":
          messages.push([i])
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          button.push(...this.makeButtons(data, [[{ text: i.name || i.file, link: i.file }]]))
          content += "[文件(请点击按钮查看)]"
          break
        case "at":
          if (i.qq === "all") content += "@everyone"
          else content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, "")}>`
          break
        case "text": {
          const [text, temp] = this.makeMarkdownText(data, i.text, content, button)
          if (Array.isArray(temp)) {
            template = this.makeMarkdownTemplatePush(temp, template, templates)
            content = text
          } else {
            content += text
          }
          break
        }
        case "image": {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary)
          template = this.makeMarkdownTemplatePush([[content, des]], template, templates)
          content = url
          break
        }
        case "markdown":
          if (typeof i.data === "object") messages.push([{ type: "markdown", ...i.data }])
          else content += i.data
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "reply":
          if (i.id.startsWith("event_")) reply = { type: "reply", event_id: i.id.replace(/^event_/, "") }
          else reply = i
          continue
        case "node":
          for (const { message } of i.data) messages.push(...(await this.makeMarkdownMsg(data, message)))
          continue
        case "raw":
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        default: {
          const [text, temp] = this.makeMarkdownText(data, Bot.String(i), content, button)
          if (Array.isArray(temp)) {
            template = this.makeMarkdownTemplatePush(temp, template, templates)
            content = text
          } else {
            content += text
          }
        }
      }
    }

    if (content) template.push(content)
    messages.push(...this.makeMarkdownTemplate(data, templates))

    if (button.length) {
      for (const i of messages) {
        if (i[0].type === "markdown") i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([...this.makeMarkdownTemplate(data, [[" "]])[0], ...button.splice(0, 5)])
      }
    }

    if (reply) for (const i of messages) i.unshift(reply)
    return messages
  }

  async makeMsg(data, msg) {
    const messages = []
    const button = []
    let message = []
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "at":
          continue
        case "text":
          if (!i.text || !i.text.trim()) continue
          break
        case "face":
        case "ark":
        case "embed":
          break
        case "record":
          i.type = "audio"
          i.file = await this.makeRecord(i.file)
        case "video":
        case "image":
          if (message.length) {
            messages.push(message)
            message = []
          }
          if (this.sharp && i.file) i.file = await this.compressImage(data, i.file)
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          i = { type: "text", text: `文件：${i.file}` }
          break
        case "reply":
          if (i.id.startsWith("event_")) reply = { type: "reply", event_id: i.id.replace(/^event_/, "") }
          else reply = i
          continue
        case "markdown":
          if (typeof i.data === "object") i = { type: "markdown", ...i.data }
          else i = { type: "markdown", content: i.data }
          break
        case "button":
          continue
        case "node":
          for (const { message } of i.data) messages.push(...(await this.makeMsg(data, message)))
          continue
        case "raw":
          if (Array.isArray(i.data)) {
            messages.push(i.data)
            continue
          }
          i = i.data
          break
        default:
          i = { type: "text", text: Bot.String(i) }
      }

      if (i.type === "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) {
          for (const url of match) {
            const msgImg = { type: "image", file: await this.makeQRCode(url) }
            if (message.length) {
              messages.push(message)
              message = []
            }
            message.push(msgImg)
            i.text = i.text.replace(url, "[链接(请扫码查看)]")
          }
        }
      }

      message.push(i)
    }

    if (message.length) messages.push(message)

    while (button.length) {
      messages.push([{ type: "keyboard", content: { rows: button.splice(0, 5) } }])
    }

    if (reply) for (const i of messages) i.unshift(reply)
    return messages
  }

  async makeGuildMsg(data, msg) {
    const messages = []
    let message = []
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "at":
          i.user_id = i.qq?.replace?.(/^qg_/, "")
        case "text":
        case "face":
        case "ark":
        case "embed":
          break
        case "image":
          message.push(i)
          messages.push(message)
          message = []
          continue
        case "record":
        case "video":
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          i = { type: "text", text: `文件：${i.file}` }
          break
        case "reply":
          reply = i
          continue
        case "markdown":
          if (typeof i.data === "object") i = { type: "markdown", ...i.data }
          else i = { type: "markdown", content: i.data }
          break
        case "button":
          continue
        case "node":
          for (const { message } of i.data) messages.push(...(await this.makeGuildMsg(data, message)))
          continue
        case "raw":
          if (Array.isArray(i.data)) {
            messages.push(i.data)
            continue
          }
          i = i.data
          break
        default:
          i = { type: "text", text: Bot.String(i) }
      }

      if (i.type === "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) {
          for (const url of match) {
            const msgImg = { type: "image", file: await this.makeQRCode(url) }
            message.push(msgImg)
            messages.push(message)
            message = []
            i.text = i.text.replace(url, "[链接(请扫码查看)]")
          }
        }
      }

      message.push(i)
    }

    if (message.length) messages.push(message)
    if (reply) for (const i of messages) i.unshift(reply)
    return messages
  }
}
