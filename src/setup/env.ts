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

console.log(`\n${chalk.cyan.bold('Let\'s create or update a .env file...')}\n`);

(async (): Promise<void> => {
  try {
    await stageSelect();

    spinner.start('Resolving values...');

    const ssmEnv: string[] = await require(join(slseedrc.configs, 'ssm.env'));
    const ssm = new AWS.SSM();

    const env = [
      `# Env file for [${process.env.NODE_ENV}] stage.\n`,
      '# Selected env',
      `NODE_ENV=${process.env.NODE_ENV}`
    ];

    await Promise.all(ssmEnv.map(paramName => {
      const withPrefix = slseedrc.type === 'app' && !paramName.startsWith('!');
      const name = paramName.replace(/^!/, '');

      const promise = resolveParam(ssm, name).then(({ envVar, Parameter }) => {
        const prefix = withPrefix ? 'VUE_APP_' : '';

        env.push(
          `# SSM:/${Parameter.Name}`,
          `${prefix}${envVar}=${Parameter.Value}`
        );
      });

      return promise;
    }));

    spinner.succeed('SSM params resolved.');

    writeFileSync(`.env.${process.env.NODE_ENV}`, env.join('\n'), 'utf8');

    spinner.succeed(`File ${chalk.dim(`.env.${process.env.NODE_ENV}`)} has been saved.`);
  } catch (err) {
    spinner.fail(err.message);
  }
})();
