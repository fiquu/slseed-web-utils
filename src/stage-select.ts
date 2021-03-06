import AWS, { SharedIniFileCredentials } from 'aws-sdk';
import { prompt } from 'inquirer';
import { join } from 'path';
import rcfile from 'rcfile';
import yargs from 'yargs';

interface Arguments {
  useAwsProfiles?: boolean;
  stage?: string;
}

let profileSet = false;
const slseedrc = rcfile('slseed');
const { stage, useAwsProfiles }: Arguments = yargs.options({
  useAwsProfiles: {
    default: true,
    type: 'boolean'
  },
  stage: {
    default: null,
    type: 'string'
  }
}).argv;

/**
 * Selects and sets proper stage and profiles.
 *
 * @returns {Promise<string>} A promise to the selected profile name.
 */
export default async (): Promise<string> => {
  if (profileSet) {
    return process.env.NODE_ENV;
  }

  // eslint-disable-next-line security/detect-non-literal-require
  const { region, profiles, apiVersions } = await require(join(slseedrc.configs, 'aws'));
  const { profile } = stage ? { profile: stage } : await prompt({
    name: 'profile',
    type: 'list',
    message: 'Which stage do you want to affect?',
    choices: Object.keys(profiles)
  });

  if (!Object.keys(profiles).includes(String(profile))) {
    throw new Error('Invalid profile');
  }

  process.env.NODE_ENV = String(profile);

  if (useAwsProfiles) {
    process.env.AWS_PROFILE = profiles[String(profile)];
    process.env.AWS_DEFAULT_REGION = region;
    process.env.AWS_SECRET_ACCESS_KEY = '';
    process.env.AWS_ACCESS_KEY_ID = '';

    const credentials = new SharedIniFileCredentials({
      profile: profiles[String(profile)]
    });

    AWS.config.update({
      apiVersions,
      credentials,
      region
    });
  }

  profileSet = true;

  return String(profile);
};
