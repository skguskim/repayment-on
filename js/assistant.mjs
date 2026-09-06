import { SCENARIOS } from './cashflow.mjs';

export const CHAT_LIMITS = Object.freeze({question:2000,reply:6000,historyMessages:8,historyChars:8000});
const exactKeys=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));

// Only completed user/assistant pairs can become conversation history.
export function validateChatRequest({question,history=[],activeScenario='base'}) {
  if(typeof question!=='string' || !question.trim() || question.length>CHAT_LIMITS.question) throw new Error('질문은 1~2,000자로 입력해 주세요.');
  if(typeof activeScenario!=='string' || !Object.hasOwn(SCENARIOS,activeScenario)) throw new Error('현재 비교 상황을 확인해 주세요.');
  if(!Array.isArray(history) || history.length>CHAT_LIMITS.historyMessages || history.length%2!==0) throw new Error('대화 내역을 확인해 주세요.');
  let size=0;
  const messages=history.map((message,i)=>{
    const role=i%2===0?'user':'assistant',limit=role==='user'?CHAT_LIMITS.question:CHAT_LIMITS.reply;
    if(!exactKeys(message,['role','content']) || message.role!==role || typeof message.content!=='string' || !message.content.trim() || message.content.length>limit) throw new Error('대화 내역을 확인해 주세요.');
    size+=message.content.length;
    return {role,content:message.content};
  });
  if(size>CHAT_LIMITS.historyChars) throw new Error('대화 내역이 너무 깁니다.');
  return {question:question.trim(),history:messages,activeScenario};
}

export function recentChatHistory(messages) {
  const history=messages.slice(-CHAT_LIMITS.historyMessages).map(({role,content})=>({role,content}));
  while(history.reduce((sum,message)=>sum+message.content.length,0)>CHAT_LIMITS.historyChars) history.splice(0,2);
  return history;
}

export function validateChatReply(value) {
  if(!exactKeys(value,['mode','reply']) || value.mode!=='ai' || typeof value.reply!=='string' || !value.reply.trim() || value.reply.length>CHAT_LIMITS.reply) throw new Error('답변을 받지 못했어요. 다시 시도해 주세요.');
  return value.reply.trim();
}
