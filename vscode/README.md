# Blueprint for VS Code

The structural blueprint of your workspace, next to your code.

- **Blueprint: Open structural blueprint** (layers icon in the editor title bar): the interactive 2D/3D blueprint in a side panel. Click **Open in editor** on any block to jump to the file. It redraws every time you save.
- **Blueprint: What breaks if I change this file?** (right-click in the editor or explorer): the blast radius, as a list you can jump through.
- **Status bar**: the structural role of the current file, e.g. `▦ pillar · holds up 12 (27%)`.

Works with TypeScript, JavaScript, Python and Go. Reads `docker-compose` to connect services.
