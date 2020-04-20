import { prompt } from 'inquirer';
import AWS from 'aws-sdk';
import ora from 'ora';

const spinner = ora();

/**
 * @param {string} Bucket The bucket name to list for.
 */
export async function listVersionsInBucket(Bucket: string) {
  const s3 = new AWS.S3();

  const { CommonPrefixes } = await s3.listObjects({
    Delimiter: '/',
    MaxKeys: 1000,
    Bucket
  }).promise();

  return CommonPrefixes.map(({ Prefix }) => Prefix.replace(/\/$/, '').replace(/^v/, '')).reverse();
}

/**
 * @param {string} Bucket The bucket name to delete from.
 * @param {string} version the version key to delete.
 */
export async function deleteVersionFromBucket(Bucket: string, version: string) {
  spinner.start(`Listing "${version}" objects...`);

  const s3 = new AWS.S3();

  const { Contents } = await s3.listObjects({
    Prefix: `v${version}/`,
    MaxKeys: 1000,
    Bucket
  }).promise();

  spinner.start(`Deleting "${version}" objects...`);

  const Objects = Contents.map(({ Key }) => ({ Key }));

  await s3.deleteObjects({
    Bucket,
    Delete: {
      Objects
    }
  }).promise();

  spinner.succeed(`Version "${version}" deleted.`);
}

/**
 * @param {string} Bucket The bucket to resolve for.
 * @param {string} current The current version.
 */
export async function prunePreviousVersions(Bucket, current) {
  spinner.start('Listing deployed versions...');

  const versions = await listVersionsInBucket(Bucket);

  if (versions.length < 3) {
    spinner.warn('There must be at least 3 deployed versions to prune the last.');
    return;
  }

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

      if (i === 1) {
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

  for (const version of selected) {
    spinner.info('Pruning old versions...');

    await deleteVersionFromBucket(Bucket, version);
  }
}
