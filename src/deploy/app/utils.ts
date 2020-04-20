import clearModule from 'clear-module';
import rcfile from 'rcfile';

/**
 * @returns {string} The new version number.
 */
export function getNewVersion(): string {
  clearModule.all();

  const { version } = rcfile('slseed').package;

  return version;
}
