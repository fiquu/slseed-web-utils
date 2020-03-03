import { prompt, ConfirmQuestion } from 'inquirer';

/**
 * Creates a simple confirm prompt message.
 *
 * @param {string} message The message to show.
 *
 * @returns {Promise<boolean>} A promise to the confirm answer.
 */
export default async function confirmPrompt(message): Promise<boolean> {
  const question: ConfirmQuestion = {
    name: 'confirm',
    type: 'confirm',
    default: true,
    message
  };

  const { confirm } = await prompt(question);

  return confirm;
}
