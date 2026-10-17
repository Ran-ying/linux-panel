/** Explicit ordinary-user shell capability; all other new writes stay denied. */
export function isUserShellAction(action) {
  return action?.id==='terminal.execute' && action.kind==='write' &&
    action.permission==='terminal:execute' && action.executionPolicy==='user-shell';
}

/** Source-approved ordinary-user file writes, authenticated Web only. */
export function isUserFileAction(action) {
  return ['files.write','files.upload','files.create','files.rename','files.delete','files.chmod','files.chown'].includes(action?.id) && action.kind==='write' &&
    action.permission==='files:write' && action.executionPolicy==='user-files';
}


/** Fixed low-privilege bot interaction through a loopback-only Telegram MCP bridge. */
export function isTelegramInteractionAction(action) {
  return ['telegram.send','telegram.press'].includes(action?.id) &&
    action.kind==='write' && action.permission==='telegram:write' &&
    action.executionPolicy==='telegram-interaction' && action.exposure?.mcp===true;
}
