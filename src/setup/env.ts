import { writeFileSync } from 'fs';
import { posix, join } from 'path';
import rcfile from 'rcfile';
import chalk from 'chalk';
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
 * Resolves an SSM parameter.
 *
 * @param {AWS.SSM} ssm The SSM instance.
 * @param {string} name The SSM parameter name.
 *
 * @returns {object} A promise to the parameter env var name and Parameter data.
 */
const resolveParam = async (ssm, name): Promise<SSMParamSet> => {
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
};

/**
 * @param {string} paramName The parameter name to resolve.
 *
 * @returns {Promise<string[]>} The values to append to the env.
 */
const getParamPromise = paramName => {
  const withPrefix = slseedrc.type === 'app' && !paramName.startsWith('!');
  const name = paramName.replace(/^!/, '');
  const ssm = new AWS.SSM();

  const promise = resolveParam(ssm, name).then(({ envVar, Parameter }) => {
    const prefix = withPrefix ? 'VUE_APP_' : '';

    return [`# SSM:${Parameter.Name}\n${prefix}${envVar}=${Parameter.Value}`];
  });

  return promise;
};

console.log(`\n${chalk.cyan.bold('Let\'s create or update a .env file...')}\n`);

(async (): Promise<void> => {
  try {
    await stageSelect();

    spinner.start('Resolving values...');

    const { NODE_ENV } = process.env;

    const isApp = slseedrc.type === 'app';
    const fileName = `.env.${NODE_ENV}${isApp ? '.local' : ''}`;
    // eslint-disable-next-line security/detect-non-literal-require
    const logLevels: string[] = await require(join(slseedrc.configs, 'log-levels'));
    // eslint-disable-next-line security/detect-non-literal-require
    const ssmEnv: string[] = await require(join(slseedrc.configs, 'ssm-env'));

    const env = [
      `# Env file for [${NODE_ENV}] stage.\n`,
      `# Selected Node env\nNODE_ENV=${NODE_ENV}`,
      `# Log level\nLOG_LEVEL=${logLevels[String(NODE_ENV)]}`
    ];

    if (isApp) {
      env.push(`# Vue app environment (NODE_ENV may differ)\nVUE_APP_ENV=${NODE_ENV}`);
    }

    await Promise.all(ssmEnv.map(paramName =>
      getParamPromise(paramName).then(values => env.push(...values))
    ));

    spinner.succeed('SSM params resolved.');

    writeFileSync(fileName, env.sort().join('\n'), 'utf8');

    spinner.succeed(`File ${chalk.dim(fileName)} has been saved.`);
  } catch (err) {
    spinner.fail(err.message);
    process.exitCode = 1;
  }
})();
