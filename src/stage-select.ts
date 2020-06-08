import AWS, { SharedIniFileCredentials } from 'aws-sdk';
import { prompt } from 'inquirer';
import yargs from 'yargs';
import { join } from 'path';
import rcfile from 'rcfile';

interface Arguments {
  profile?: string;
}

const slseedrc = rcfile('slseed');
const argv: Arguments = yargs.options({
  profile: {
    default: null,
    type: 'string'
  }
}).argv;

/**
 * Selects and sets proper stage and profiles.
 *
 * @param {boolean} env Whether to set `process.env` vars also.
 *
 * @returns {Promise<string>} A promise to the selected profile name.
 */
export default async (env = true): Promise<string> => {
  const { region, profiles, apiVersions } = await require(join(slseedrc.configs, 'aws'));
  const { profile } = argv.profile ? { profile: argv.profile } : await prompt({
    name: 'profile',
    type: 'list',
    message: 'Which stage do you want to affect?',
    choices: Object.keys(profiles)
  });

  if (!Object.keys(profiles).includes(String(profile))) {
    throw new Error('Invalid profile');
  }

  if (env) {
    process.env.AWS_PROFILE = profiles[String(profile)];
    process.env.NODE_ENV = String(profile);
  }

  const credentials: SharedIniFileCredentials = new SharedIniFileCredentials({
    profile: profiles[String(profile)]
  });

  // Update AWS config
  AWS.config.update({
    apiVersions,
    credentials,
    region
  });

  return String(profile);
};
