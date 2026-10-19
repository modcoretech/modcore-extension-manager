# modcore Extension Manager

A free, open-source browser extension manager for Chrome and other Chromium-based browsers. Enable, disable, group, audit and back up your extensions from one place, with no tracking, no accounts and no data leaving your device.

modcore Extension Manager (modcore EM) is built for people who run a lot of extensions and want to know what each one can actually do. It combines a fast popup and side panel with permission risk scoring, scheduled automations, an extension change history and portable backups. Everything runs locally inside your browser.

Developed by [modcore](https://github.com/modcoretech) and released under the Apache 2.0 License.

## Contents

- [Features](#features)
- [Privacy and security](#privacy-and-security)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Language support](#language-support)
- [Frequently asked questions](#frequently-asked-questions)
- [Contributing](#contributing)
- [Support and contact](#support-and-contact)
- [License](#license)

## Features

### Everyday extension management

The popup and the browser side panel give you a compact list of every installed extension. Turn any of them on or off with one click, open its details, or use the per-row menu for more actions.

- Fuzzy search across name, description and extension ID
- Filter the list by enabled or disabled status
- Select several extensions at once for bulk enable, bulk disable, or bulk assignment to a profile
- Select all visible results in one click after filtering

### Profiles

Profiles save the on and off state of your extensions as a named set, so you can change your whole setup in one step. A work profile might enable your password manager and developer tools, while a reading profile keeps only an ad blocker and a dark mode extension.

- Create, rename, reorder and delete profiles from a dedicated management page
- Assign extensions to a profile directly from the popup
- Give a profile its own keyboard shortcut, with validation to prevent conflicts
- Apply a profile and get a clear summary of what changed, what was already correct and what was skipped
- Stale entries for uninstalled extensions are cleaned up automatically

### Safety Center

The Safety Center explains what your extensions are allowed to do and rates the risk of each one based on the permissions it requests.

- A dashboard with an overall safety score, a risk distribution chart and a list of the most requested permissions
- Extensions ranked by risk so the ones that deserve attention appear first
- A report for each extension with a written assessment and the top permissions driving its score
- Every API permission and host permission grouped by risk level (high, moderate and low), with search and filters
- Plain-language explanations for each permission, including common legitimate uses and a link to the official Chrome documentation
- A metadata tab with technical details such as version, ID, install type and more

### Automations

Automations switch extensions on or off without you touching anything. Rules can trigger on the clock, on the site you are visiting, or on a combination of both.

- Time triggers for a specific time on selected days of the week
- Time range triggers, including ranges that run overnight
- URL triggers that match a site exactly, by prefix or by a contained string, regardless of http or https
- Compound rules that combine conditions with AND or OR logic
- Actions that enable or disable individual extensions, or apply a whole profile
- Built-in safeguards so an automation never disables modcore EM itself

### Timeline

The Timeline keeps a local history of what changed in your browser's extension list, which helps when something starts behaving differently and you want to know why.

- Records installs, uninstalls, updates, enable and disable events
- Flags permission changes and shows exactly which permissions or site access were added or removed
- A background check every five minutes catches changes that happened while the browser was closed or the service worker was asleep
- Tracking is off by default and only starts when you turn it on
- Control sort order, entries per page, how many days to keep, and the maximum number of records
- Clear the whole history, prune old entries, or remove records for extensions you no longer have

### Snapshot backup and restore

modcore Snapshot exports your data to a single JSON file and brings it back later, which makes it easy to move to a new computer or recover after a reinstall.

- Choose which categories of data to include in each backup
- Review the contents of a backup file before restoring and deselect anything you want to keep as is
- Drag and drop restore with a clear warning about what will be replaced
- See what modcore EM stores on your device and clear individual categories you no longer need

### CRX downloads from the Chrome Web Store

On a Chrome Web Store extension page, a context menu entry lets you download the extension package as a `.crx` file. Files are named with the extension name, a short ID prefix and the version, so a folder of downloads stays easy to sort. This is useful for archiving a known good version, offline installs and manual source review.

### Toolbar quick actions

Right-click the toolbar icon for shortcuts that apply to everything at once:

- Disable all extensions for a clean troubleshooting session
- Enable all extensions to restore them afterwards
- Extensions that the browser does not allow to be disabled are left alone

### Built-in issue reporter

Press `Alt+Shift+E` to open a reporter for bugs, feature ideas and general feedback. It opens a pre-filled GitHub issue or discussion. You decide whether to attach technical environment details, your extension list or recent console logs, and you can review everything before submitting. Nothing is sent automatically.

## Privacy and security

modcore EM keeps its footprint small and its behavior transparent.

- No analytics, telemetry, advertising or tracking of any kind
- No account, no sign-in and no remote servers holding your data
- All settings, profiles, rules and history are stored locally in your browser
- Works fully offline, apart from fetching a CRX file from the Chrome Web Store
- Built on Manifest V3 with a strict Content Security Policy that only allows scripts bundled with the extension
- Network access is limited to two Chrome Web Store hosts used for CRX downloads

### Permissions explained

| Permission | Why it is needed |
| :--- | :--- |
| `management` | List, enable and disable installed extensions |
| `storage` | Save profiles, automation rules, timeline history and settings locally |
| `alarms` | Run scheduled automations and the periodic timeline check |
| `tabs` | Read the active tab address for URL based automations and the Web Store menu |
| `downloads` | Save CRX files with a clear file name |
| `contextMenus` | Add toolbar and Web Store page menu entries |
| `sidePanel` | Show the extension manager in the browser side panel |

The source is open, so anyone can verify these claims. If you find a vulnerability, please follow the process in [SECURITY.md](SECURITY.md).

## Installation

modcore EM is installed from a release package:

1. Open the [Releases page](https://github.com/modcoretech/modcore-extension-manager/releases) and download the latest `.zip` file
2. Extract the archive to a folder you plan to keep
3. Open your browser's extensions page, for example `chrome://extensions/` or `edge://extensions/`
4. Turn on Developer mode
5. Choose Load unpacked and select the extracted folder

The modcore EM icon will appear in your toolbar. Pin it for quick access. The side panel needs a browser version that supports the Chrome side panel API.

## Quick start

1. Click the toolbar icon to see all your extensions
2. Use the search box and status filter to find what you need
3. Open the Safety Center and look at the extensions with the lowest scores first
4. Create a profile for each way you use your browser and assign extensions to it
5. Add an automation if you want a profile or a set of extensions to switch on a schedule or on specific sites
6. Turn on Timeline tracking if you want a history of extension changes
7. Create a Snapshot backup so your setup is easy to restore

## Keyboard shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt+Shift+E` | Open the issue reporter |
| `Ctrl+Shift+Key` or `Alt+Shift+Key` | Apply a profile, using the shortcut you assign to it |

## Language support

The interface is currently in English. The extension description shown in the browser is available in English, German, Spanish, French, Italian, Japanese and Russian. A full interface translation is not planned while the project is changing quickly. See [the locales notes](_locales/README.md) for the reasoning and for guidance if you want to build your own translation.

## Frequently asked questions

### Does modcore Extension Manager collect any data?

No. It has no analytics or telemetry, and it does not send your extension list, profiles or history anywhere. Everything stays in local browser storage.

### How is the Safety Center score calculated?

Each extension is scored from the permissions and site access it requests. Broad access, such as reading all websites or controlling browser behavior, lowers the score more than narrow permissions. Every permission is explained in the report so you can judge for yourself, because a high risk permission is not always a sign of a bad extension.

### Will modcore EM disable itself?

No. Bulk actions, profiles and automations all skip modcore EM, and they also skip extensions that your browser does not allow to be disabled.

### Can I move my profiles and rules to another computer?

Yes. Create a backup with modcore Snapshot, copy the JSON file across, and restore it on the other browser.

### Why does Timeline show nothing at first?

Timeline tracking is opt-in and starts empty. Turn it on in the Timeline settings and new changes will be recorded from that point.

### Which browsers are supported?

Chrome and other Chromium-based browsers that support Manifest V3 and the extension management API.

## Contributing

Contributions are welcome, from code and bug reports to documentation fixes.

1. Fork the [repository](https://github.com/modcoretech/modcore-extension-manager)
2. Create a branch for your change
3. Open a pull request that describes what you changed and why

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full guidelines and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## Support and contact

- Bugs and feature requests: [GitHub Issues](https://github.com/modcoretech/modcore-extension-manager/issues)
- Security reports: see [SECURITY.md](SECURITY.md)
- Email: [modcoretech@proton.me](mailto:modcoretech@proton.me)
- X: [@modcoretech](https://x.com/modcoretech)
- Project support: [modcore on Patreon](https://www.patreon.com/cw/modcore)

## License

modcore Extension Manager is released under the Apache 2.0 License. See [LICENSE](LICENSE) for details.
