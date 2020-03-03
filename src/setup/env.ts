import { writeFileSync } from 'fs';
import { posix, join } from 'path';
import rcfile from 'rcfile';
import AWS from 'aws-sdk';
import ora from 'ora';

import stageSelect from '../stage-select';

const slseedrc = rcfile('slseed');
const spinner = ora();

interface SSMParamSet {
  Parameter: AWS.SSM.Parameter;
  envVar: string;
}

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
 * @param {string} name The SSM parameter name.
 *
 * @returns {object} A promise to the parameter env var name and Parameter data.
 */
async function resolveParam(ssm, name): Promise<SSMParamSet> {
  const params = {
    Name: posix.join('/', slseedrc.stack, process.env.NODE_ENV, name),
    WithDecryption: true
  };

  try {
    const { Parameter } = await ssm.getParameter(params).promise();
    const envVar = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

    return { envVar, Parameter };
  } catch (err) {
    spinner.fail(`${err.code}: ${params.Name}`);
    throw err;
  }
}

(async (): Promise<void> => {
  try {
    await init();

    spinner.start(`Setting env file for [${process.env.NODE_ENV}]...`);

    const ssmEnv: string[] = await import(join(slseedrc.configs, 'ssm.env'));
    const env = [`NODE_ENV=${process.env.NODE_ENV}`];
    const ssm = new AWS.SSM();

    await Promise.all(ssmEnv.map(paramName => {
      const withPrefix = slseedrc.type === 'app' && !paramName.startsWith('!');
      const name = paramName.replace(/^!/, '');

      const promise = resolveParam(ssm, name).then(({ envVar, Parameter }) => {
        const prefix = withPrefix ? 'VUE_APP_' : '';

        spinner.info(`${prefix}${envVar}=[ssm:${Parameter.Name}]`);

        env.push(`${prefix}${envVar}=${Parameter.Value}`);
      });

      return promise;
    }));

    writeFileSync(`.env.${process.env.NODE_ENV}`, env.join('\n'), 'utf8');

    spinner.succeed('DotEnv file saved!');
  } catch (err) {
    spinner.fail(err.message);
    throw err;
  }
})();
