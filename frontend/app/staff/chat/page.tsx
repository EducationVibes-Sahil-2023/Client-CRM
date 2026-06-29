"use client";

import { PageHeader } from "../../admin/ui";
import ChatView from "../../components/chat/ChatView";

export default function StaffChatPage() {
  return (
    <>
      <PageHeader title="Chat" subtitle="Message your team and admins in real time" />
      <ChatView area="staff" />
    </>
  );
}
