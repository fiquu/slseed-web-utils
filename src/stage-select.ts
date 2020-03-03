import { prompt } from 'inquirer';
import { join } from 'path';
import rcfile from 'rcfile';
import AWS from 'aws-sdk';

const slseedrc = rcfile('slseed');

/**
 * Selects and sets proper stage and profiles.
 *
 * @param {boolean} env Whether to set `process.env` vars also.
 *
 * @returns {Promise<string>} A promise to the selected profile name.
 */
export default async (env = true): Promise<string> => {
  const { region, profiles } = await require(join(slseedrc.configs, 'aws'));
  const { profile } = await prompt({
    name: 'profile',
    type: 'list',
    message: 'Select target stage:',
    choices: Object.keys(profiles)
  });

  if (env) {
    process.env.AWS_PROFILE = profiles[String(profile)];
    process.env.NODE_ENV = profile;
  }

  // Update AWS config
  AWS.config.update({
    region,
    credentials: new AWS.SharedIniFileCredentials({
      profile: profiles[String(profile)]
    })
  });

  return profile;
};
