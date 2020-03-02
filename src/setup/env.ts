/**
 * Env setup.
 *
 * @example $ npm run env
 *
 * @module setup/env
 */

import { writeFileSync } from 'fs';
import { posix, join } from 'path';
import rcfile from 'rcfile';
import AWS from 'aws-sdk';
import ora from 'ora';

import stageSelect from '../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

/**
 * Initializes the proper env.
 */
async function init(): Promise<void> {
  await stageSelect();

  const { apiVersions, region } = await import(join(slseedrc.configs, 'aws.js'));

  AWS.config.update({
    apiVersions,
    region
  });
}

/**
 * Resolves an SSM parameter.
 *
 * @param {AWS.SSM} ssm The SSM instance.
 * @param {string} ssmPath The parameter path.
 *
 * @returns {object} A promise to the parameter env var name and Parameter data.
 */
async function resolveParam(ssm, ssmPath): Promise<any> {
  const params = {
    Name: posix.join('/', slseedrc.stack, process.env.NODE_ENV, ssmPath),
    WithDecryption: true
  };

  try {
    const { Parameter } = await ssm.getParameter(params).promise();
    const name = ssmPath.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

    return { name, Parameter };
  } catch (err) {
    spinner.fail(`${err.code}: ${params.Name}`);
    throw err;
  }
}

(async (): Promise<void> => {
  try {
    await init();

    spinner.start(`Setting env file for [${process.env.NODE_ENV}]...`);

    const ssmEnv = await import(join(slseedrc.configs, 'ssm.env'));
    const env = [`NODE_ENV=${process.env.NODE_ENV}`];
    const ssm = new AWS.SSM();
    const promises = [];

    for (const ssmPath of ssmEnv) {
      const promise = resolveParam(ssm, ssmPath).then(({ name, Parameter }) => {
        const prefix = `${slseedrc.type === 'app' ? 'VUE_APP_' : ''}`;

        spinner.info(`${name}=[ssm:${Parameter.Name}]`);
        env.push(`${prefix}${name}=${Parameter.Value}`);
      });

      promises.push(promise);
    }

    await Promise.all(promises);

    writeFileSync(`.env.${process.env.NODE_ENV}`, env.join('\n'), 'utf8');

    spinner.succeed('Env file saved!');
  } catch (err) {
    spinner.fail(err.message);
    throw err;
  }
})();
