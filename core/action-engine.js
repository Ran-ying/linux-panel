import Ajv from 'ajv';

/**
 * v0.1 safety boundary: local-only, read-only operations.
 * Authentication, approval, audit persistence and privileged execution are
 * REQUIRED before any mutating action is enabled.
 */
export class ActionEngine {
  constructor(registry) {
    this.registry = registry;
    this.ajv = new Ajv({ allErrors: true, strict: false });
    this.validators = new Map();
  }

  #resolve(id, channel, input) {
    const action = this.registry.get(id);
    if (!action || action.exposure?.[channel] !== true) {
      throw Object.assign(new Error('Action unavailable'), { statusCode: 404 });
    }
    if (action.kind !== 'read') {
      throw Object.assign(new Error('Write actions are disabled in v0.1'), { statusCode: 403 });
    }
    let validate = this.validators.get(id);
    if (!validate) {
      validate = this.ajv.compile(action.inputSchema);
      this.validators.set(id, validate);
    }
    if (!validate(input)) {
      const err = new Error('Invalid input');
      err.statusCode = 400;
      err.details = validate.errors;
      throw err;
    }
    return action;
  }

  async preview(id, input = {}, channel = 'web') {
    const action = this.#resolve(id, channel, input);
    return {
      action: id,
      kind: action.kind,
      steps: typeof action.createPlan === 'function'
        ? await action.createPlan(input)
        : [{ description: 'No preview available' }],
      note: 'Preview is informational for this read-only v0.1 action.'
    };
  }

  async run(id, input = {}, channel = 'web') {
    const action = this.#resolve(id, channel, input);
    return { action: id, result: await action.execute(input) };
  }
}
