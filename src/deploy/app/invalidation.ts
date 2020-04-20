import AWS from 'aws-sdk';

/**
 * Invalidates the deploy CloudFront distribution.
 *
 * @param {string} distId The distribution id.
 *
 * @returns {Promise} A promise to the invalidation.
 */
export function invalidateDist(distId) {
  const cloudfront = new AWS.CloudFront();

  const Items = ['/*'];
  const params = {
    DistributionId: distId,
    InvalidationBatch: {
      CallerReference: String(Date.now()),
      Paths: {
        Quantity: Items.length,
        Items
      }
    }
  };

  return cloudfront.createInvalidation(params).promise();
}

/**
 * @param {string} Id The distribution id.
 */
export async function getDistStatus(Id): Promise<string> {
  const cloudfront = new AWS.CloudFront();

  const { Distribution } = await cloudfront.getDistribution({ Id }).promise();

  return Distribution.Status;
}

/**
 * Checks for the stack status.
 *
 * @param {string} Id The distribution Id name.
 */
export async function waitForDeployed(Id: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      getDistStatus(Id).then(status => {
        if (status === 'Deployed') {
          clearInterval(interval);

          resolve(true);

          return;
        }
      }).catch(reject);
    }, 5000);
  });
}
