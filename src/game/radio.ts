/** The three 1.6 radio menus (Z, X, C), plus CS:GO-style site calls so you can direct bots. */
export type RadioCommand =
  | 'coverme'
  | 'takepoint'
  | 'holdpos'
  | 'regroup'
  | 'followme'
  | 'takingfire'
  | 'gogogo'
  | 'fallback'
  | 'sticktogether'
  | 'getinpos'
  | 'stormfront'
  | 'reportin'
  | 'goa'
  | 'gob'
  | 'affirmative'
  | 'enemyspotted'
  | 'needbackup'
  | 'sectorclear'
  | 'inposition'
  | 'reportingin'
  | 'getout'
  | 'negative'
  | 'enemydown';

export interface RadioMenu {
  title: string;
  items: { cmd: RadioCommand; text: string }[];
}

export const RADIO_MENUS: RadioMenu[] = [
  {
    title: 'Radio Commands',
    items: [
      { cmd: 'coverme', text: 'Cover me!' },
      { cmd: 'takepoint', text: 'You take the point.' },
      { cmd: 'holdpos', text: 'Hold this position.' },
      { cmd: 'regroup', text: 'Regroup team.' },
      { cmd: 'followme', text: 'Follow me.' },
      { cmd: 'takingfire', text: 'Taking fire, need assistance!' },
    ],
  },
  {
    title: 'Group Radio Commands',
    items: [
      { cmd: 'gogogo', text: 'Go go go!' },
      { cmd: 'fallback', text: 'Team, fall back!' },
      { cmd: 'sticktogether', text: 'Stick together, team.' },
      { cmd: 'getinpos', text: 'Get in position and wait for my go.' },
      { cmd: 'stormfront', text: 'Storm the front!' },
      { cmd: 'reportin', text: 'Report in, team.' },
      { cmd: 'goa', text: 'Go A!' },
      { cmd: 'gob', text: 'Go B!' },
    ],
  },
  {
    title: 'Radio Responses/Reports',
    items: [
      { cmd: 'affirmative', text: 'Affirmative.' },
      { cmd: 'enemyspotted', text: 'Enemy spotted.' },
      { cmd: 'needbackup', text: 'Need backup.' },
      { cmd: 'sectorclear', text: 'Sector clear.' },
      { cmd: 'inposition', text: "I'm in position." },
      { cmd: 'reportingin', text: 'Reporting in.' },
      { cmd: 'getout', text: "Get out of there, it's gonna blow!" },
      { cmd: 'negative', text: 'Negative.' },
      { cmd: 'enemydown', text: 'Enemy down.' },
    ],
  },
];

export function radioText(cmd: RadioCommand): string {
  for (const m of RADIO_MENUS) for (const i of m.items) if (i.cmd === cmd) return i.text;
  return cmd;
}
