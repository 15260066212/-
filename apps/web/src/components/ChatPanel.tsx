import { useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { MessageBubble } from './MessageBubble.js';
import { InputArea } from './InputArea.js';
import { ProfileReviewForm } from './ProfileReviewForm.js';

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

export function ChatPanel() {
  const { messages, sessionData, isLoading, showProfileReview, sendMessage, submitUrl, confirmProfileReview } = useSessionStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    (text: string) => {
      if (isUrl(text)) {
        submitUrl(text);
      } else {
        sendMessage(text);
      }
    },
    [sendMessage, submitUrl],
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-1">
        {messages.length === 0 && !isLoading && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            开始对话以配置您的 GEO 策略
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {showProfileReview && sessionData && (
          <ProfileReviewForm
            sessionData={sessionData}
            isLoading={isLoading}
            onConfirm={confirmProfileReview}
          />
        )}
        {isLoading && (
          <div className="flex justify-start mb-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-muted text-muted-foreground">
                <div className="w-4 h-4" />
              </div>
              <div className="bg-card text-muted-foreground shadow-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <InputArea
        onSend={handleSend}
        isLoading={isLoading || showProfileReview}
        placeholder="输入回答或粘贴官网 URL..."
      />
    </div>
  );
}
