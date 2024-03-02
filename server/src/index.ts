import fs from "node:fs"
import crypto from "node:crypto"

import express, { Request } from "express"
import multer from "multer"
import cors from "cors"

import WebSocket from "ws"

import pino from "pino"
const logger = pino()

import { MessageService } from "./services/MessageService"

const STORAGE_PATH = "/tmp/client-side-compression/"
const HTTP_PORT = process.env.HTTP_PORT || 3000
const WS_PORT = process.env.WS_PORT || 8080

const MAX_FILE_SIZE = 1024 * 1024 * 16 // 16MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "video/mp4": "mp4",
}

if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH)
}

const wss = new WebSocket.Server({
  host: "0.0.0.0",
  port: Number(WS_PORT)
})

class InternalClient { constructor(public nickname: string, public connection: WebSocket) { } }
let websocketClients: InternalClient[] = []

const messageService = new MessageService()

wss.on("listening", () => logger.info("websocket server running"))
wss.on("error", (err) => logger.error(err, "websocket server error"))
wss.on("connection", (client) => {
  client.on("close", () => {
    logger.info("websocket client disconnected")
    websocketClients = websocketClients.filter((c) => c.connection !== client)
  })

  client.on("message", (message) => {
    const isSubscribeMessage = message.toString().startsWith("subscribe:")

    if (isSubscribeMessage) {
      const nickname = message.toString().replace("subscribe:", "")
      const internalClient = new InternalClient(nickname, client)
      websocketClients.push(internalClient)
      return
    }

    const storedClient = websocketClients.find((c) => c.connection === client)
    if (!storedClient) {
      return
    }
    wsMessageHandler(storedClient, message)
  })
})

async function broadcast(message: any, ...clients: Array<InternalClient | undefined>) {
  const payload = JSON.stringify({ type: "message", message })
  clients.forEach((c) =>  {
    if (!c) return
    c.connection.send(payload)
  })
}

async function wsMessageHandler(client: InternalClient, message: WebSocket.RawData) {
  const data = JSON.parse(message.toString())
  if (data.type === "ping") {
    client.connection.send(JSON.stringify({ type: "pong" }))
  }

  if (data.type === "message") {
    const { message } = data

    if (message.type === "text") {
      const registeredMessage = await messageService.newTextMessage(message)

      const receiver = websocketClients.find((c) => c.nickname === registeredMessage.receiver)
      broadcast(registeredMessage, client, receiver)

      return
    }

    if (message.type === "image" || message.type === "video") {
      const registeredMessage = await messageService.newMediaMessage(message)

      const receiver = websocketClients.find((c) => c.nickname === registeredMessage.receiver)
      broadcast(registeredMessage, client, receiver)

      return
    }
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_PATH)
  },
  filename: (_, file, cb) => {
    const hash = crypto.createHash("sha256")
      .update(file.originalname + Date.now())
      .digest("hex")

    const extension = ALLOWED_MIME_TYPES[file.mimetype]
    if (!extension) {
      return cb(new Error("Invalid file type"), "")
    }

    const filename = `${hash}.${extension}`
    cb(null, filename)
  }
})

function fileFilter(req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new Error("Invalid file type"))
  }

  if (file.size > MAX_FILE_SIZE) {
    return cb(new Error("File too large"))
  }

  cb(null, true)
}

const upload = multer({ storage, fileFilter })

const app = express()
app.use(cors())
app.use(express.json())

app.get("/health", (_, res) => {
  return res.status(200).json({ status: "ok" })
})

app.post("/upload", upload.single("file"), (req, res) => {
  const initTime = Date.now()
  logger.info("started file upload");
  if (!req.file) {
    logger.error("badrequest on file upload");
    return res.status(400).send("No file uploaded");
  }

  res.setHeader("Location", "download/" + req.file.filename);
  res.setHeader("Content-Type", "application/json");

  const seconds = (Date.now() - initTime) / 1000;
  logger.child({ seconds }).info("file uploaded");
  return res.status(201).json({
    mediaId: req.file.filename,
  });
})

app.get("/download/:filename", (req, res) => {
  const { filename } = req.params
  const file = `${STORAGE_PATH}/${filename}`

  if (!fs.existsSync(file)) {
    return res.status(404).send("File not found");
  }

  const type = filename.split(".").pop();
  const mimeType = Object.keys(ALLOWED_MIME_TYPES).find((key) => ALLOWED_MIME_TYPES[key] === type);

  res.setHeader("Content-Type", mimeType!)
  res.download(file);


  res.download(file)
})

app.listen(HTTP_PORT, () => logger.info("http server running"))
