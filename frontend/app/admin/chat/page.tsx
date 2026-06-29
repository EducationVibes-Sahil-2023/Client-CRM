"use client";

import { PageHeader } from "../ui";
import ChatView from "../../components/chat/ChatView";

export default function AdminChatPage() {
  return (
    <>
      <PageHeader title="Chat" subtitle="Message your clients in real time" />
      <ChatView area="superadmin" variant="full" />
    </>
  );
}
