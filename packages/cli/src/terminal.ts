// What the command line prints comes in part from the analysed repository
// (file names, titles of records) and from the assist service. A control
// character of such a text would reach the terminal as a command: ESC opens
// colour, cursor and title sequences. Line breaks and tabs stay.
// eslint-disable-next-line no-control-regex -- these characters are the point
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** A line for the terminal, each control character shown as U+FFFD. */
export function terminalText(line: string): string {
  return line.replace(CONTROLS, '\ufffd')
}
