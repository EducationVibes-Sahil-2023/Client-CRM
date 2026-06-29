"use client";

import { PageHeader } from "../../admin/ui";
import ChatView from "../../components/chat/ChatView";

export default function ChatPage() {
  return (
    <>
      <PageHeader title="Chat" subtitle="Message support, your team, and staff in real time" />
      <ChatView area="client" />
    </>
  );
}
