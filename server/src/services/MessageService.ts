import { randomUUID } from "node:crypto"
type TextMessageInput = {
  type: "text"
  content: string
  sender: string
  receiver: string
}

type MediaMessageInput = {
  type: "image" | "video"
  mediaId: string
  description: string
  sender: string
  receiver: string
}


type Message = (TextMessageInput | MediaMessageInput) & {
  id: string
  createdAt: Date
}


export class MessageService {
  public async newTextMessage(input: TextMessageInput): Promise<Message> {
    return {
      id: randomUUID(),
      createdAt: new Date(),
      ...input
    }
  }

  public async newMediaMessage(input: MediaMessageInput): Promise<Message> {
    return {
      id: randomUUID(),
      createdAt: new Date(),
      ...input
    }
  }
}
