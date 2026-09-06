const DAY = 86400000;

export async function reserveQuota(db, clientKey, now=Date.now()) {
  const id=crypto.randomUUID(), dayStart=Math.floor(now/DAY)*DAY;
  await db.prepare('DELETE FROM ai_requests WHERE created_at < ?').bind(dayStart-DAY).run();
  // One SQL statement admits at most 100/day, 6/client/minute and 2 in flight,
  // even when requests are served by different Worker instances.
  const reservation=await db.prepare(`
    INSERT INTO ai_requests (id, client_key, created_at, lease_until)
    SELECT ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM ai_requests WHERE created_at >= ?) < 100
      AND (SELECT COUNT(*) FROM ai_requests WHERE client_key = ? AND created_at > ?) < 6
      AND (SELECT COUNT(*) FROM ai_requests WHERE lease_until > ?) < 2
    RETURNING id
  `).bind(id,clientKey,now,now+30000,dayStart,clientKey,now-60000,now).first();
  return reservation?.id ?? null;
}

export async function releaseQuota(db,id) {
  await db.prepare('UPDATE ai_requests SET lease_until = 0 WHERE id = ?').bind(id).run();
}

export async function clientKeyFor(request,secret,now=Date.now()) {
  const ip=request.headers.get('cf-connecting-ip') || 'unknown';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${Math.floor(now/DAY)}:${ip}`));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
