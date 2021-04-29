import yargs, { Arguments } from 'yargs';
import { prompt } from 'inquirer';
import chalk from 'chalk';
import AWS from 'aws-sdk';
import ora from 'ora';

const spinner = ora();
const { autoDeploy }: Arguments = yargs.options({
  autoDeploy: {
    default: false,
    type: 'boolean'
  }
}).argv;

/**
 * @param {string} Bucket The bucket name to list for.
 *
 * @returns {string[]} The versions list.
 */
export const listVersionsInBucket = async (
  Bucket: string
): Promise<string[]> => {
  const s3 = new AWS.S3();

  const { CommonPrefixes } = await s3
    .listObjects({
      Delimiter: '/',
      MaxKeys: 1000,
      Bucket
    })
    .promise();

  return CommonPrefixes.map(({ Prefix }) =>
    Prefix.replace(/^v?([^/]+)\/?$/, '$1')
  ).reverse();
};

/**
 * @param {string} Bucket The bucket name to delete from.
 * @param {string} version the version key to delete.
 */
export const deleteVersionFromBucket = async (
  Bucket: string,
  version: string
): Promise<void> => {
  spinner.start(`Listing "${version}" objects...`);

  const s3 = new AWS.S3();

  const { Contents } = await s3
    .listObjects({
      Prefix: `v${version}/`,
      MaxKeys: 1000,
      Bucket
    })
    .promise();

  const Objects = Contents.map(({ Key }) => ({ Key }));

  spinner.start(`Deleting ${Objects.length} "${version}" objects...`);

  await s3
    .deleteObjects({
      Bucket,
      Delete: {
        Objects
      }
    })
    .promise();

  spinner.succeed(`Version "${version}" deleted.`);
};

/**
 * @param {string} current The current version.
 * @param {string[]} versions The deployed versions list.
 *
 * @returns {string[]} The selected versions to prune.
 */
const promptVersions = async (
  current: string,
  versions: string[]
): Promise<string[]> => {
  spinner.stop();

  const { selected } = await prompt({
    name: 'selected',
    type: 'checkbox',
    choices: versions.map((value, i) => {
      if (value === current) {
        return {
          name: `${value} (current)`,
          disabled: true,
          checked: false,
          value
        };
      }

      if (i < 3) {
        return {
          name: `${value} (previous)`,
          disabled: true,
          checked: false,
          value
        };
      }

      return {
        checked: true,
        value
      };
    })
  });

  return selected;
};

/**
 * @param {string} Bucket The bucket to resolve for.
 * @param {string} current The current version.
 */
export const prunePreviousVersions = async (
  Bucket: string,
  current: string
): Promise<void> => {
  spinner.start('Listing deployed versions...');

  const versions = await listVersionsInBucket(Bucket);

  spinner.start(`${chalk.bold('Deployed versions')}: ${versions.join(', ')}`);

  if (versions.length < 4) {
    spinner.warn(
      'There must be at least 4 deployed versions to prune the last.'
    );

    return;
  }

  // Keep current and two older versions by default
  let selected = versions.filter((value, i) => value !== current && i > 2);

  if (!autoDeploy) {
    selected = await promptVersions(current, versions);
  }

  for (const version of selected) {
    spinner.info('Pruning old versions...');

    await deleteVersionFromBucket(Bucket, version);
  }
};
