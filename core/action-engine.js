import {isUserShellAction,isUserFileAction,isTelegramInteractionAction} from './action-policy.js';
import Ajv from 'ajv';

/**
 * Validated Actions shared by Web and MCP. Write capabilities require an
 * explicit execution policy and trusted adapter context; UI metadata never grants permission.
 */
export class ActionEngine {
  constructor(registry, {commands,privilegedClient} = {}) {
    this.commands = commands;
    this.privilegedClient=privilegedClient;
    this.registry = registry;
    this.ajv = new Ajv({ allErrors: true, strict: false });
    this.inputValidators = new Map();
    this.outputValidators = new Map();
  }

  #resolve(id, channel, input, context = {}) {
    const action = this.registry.get(id);
    if (!action || action.exposure?.[channel] !== true) {
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    }
    if (action.kind === 'write') {
      // New write actions are DENIED BY DEFAULT. Only low-risk proposals with
      // their own server-side authorization can execute through trusted adapters.
      const trustedCaller=context.authenticated===true &&
        typeof context.userId==='string' && !!context.userId &&
        context.channel===channel;
      const isProposal=action.executionPolicy==='proposal-only';
      const isExactBrokerEnqueue=channel==='mcp' &&
        action.id==='panel.update.execute' &&
        action.permission==='panel:update:execute' &&
        action.executionPolicy==='broker-enqueue' &&
        context.directUpdateAuthorized===true;
      const privileged=action.executionPolicy==='privileged' && action.privileged?.channels?.includes(channel);
      if(!trustedCaller || (!isProposal && !isExactBrokerEnqueue && !isUserShellAction(action) && !isTelegramInteractionAction(action) && !(channel==='web' && isUserFileAction(action)) && !privileged))
        throw Object.assign(new Error('Write action requires explicit trusted execution policy'), { statusCode: 403 });
    }
    let validate = this.inputValidators.get(action);
    if (!validate) {
      validate = this.ajv.compile(action.inputSchema);
      this.inputValidators.set(action, validate);
    }
    if (!validate(input)) {
      const err = new Error('Invalid input');
      err.statusCode = 400;
      err.details = validate.errors;
      throw err;
    }
    return action;
  }

  async preview(id, input = {}, channel = 'web', context = {}) {
    const action = this.#resolve(id, channel, input, context);
    return {
      action: id, kind: action.kind,
      steps: this.commands?.supports(action) ? await this.commands.preview(action) : typeof action.createPlan === 'function'
        ? await action.createPlan(input)
        : [{ description: 'No preview available' }],
      note: 'Preview is informational and never triggers an update or other side effect.'
    };
  }

  async run(id, input = {}, channel = 'web', context = {}) {
    const action = this.#resolve(id, channel, input, context);
    const elevated=this.privilegedClient?.enabled && action.privileged?.channels?.includes(channel);
    const terminal = !elevated && this.commands?.supports(action)
      ? await this.commands.executeWithRaw(action,input) : null;
    const result = elevated ? await this.privilegedClient.execute(action,input,context)
      : terminal ? terminal.result : await action.execute(input, context);
    if (action.outputSchema) {
      let validate = this.outputValidators.get(action);
      if (!validate) {
        validate = this.ajv.compile(action.outputSchema);
        this.outputValidators.set(action, validate);
      }
      if (!validate(result)) {
        // Internal implementation error; do not expose raw data or internals to callers.
        const err = new Error('Action returned data that failed output validation');
        err.statusCode = 500;
        err.validationErrors = validate.errors;
        throw err;
      }
    }
    const raw=terminal?.raw ?? (isUserShellAction(action)?{command:{
      stdout:result.stdout,stderr:result.stderr,exitCode:result.exitCode
    }}:undefined);
    return {action:id,result,...(raw?{raw}:{})};
  }
}
