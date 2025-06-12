# StarCode Snippets

**⚠️ 当前正在进行重构 - 极简文件存储系统**

本项目当前正在进行重要的架构重构，将Git存储从复杂的元数据文件系统简化为纯代码文件存储：

- **Git仓库**: 只存储纯代码文件，不含任何元数据
- **VSCode本地存储**: 管理用户友好的信息（名称、分类、标签等）
- **路径映射**: 通过gitPath字段连接VSCode显示与Git文件路径

## 测试命令

使用 `starcode-snippets.testRealFileStorage` 命令测试新的极简文件存储系统。

---

A powerful code snippet manager for Visual Studio Code that allows you to save, organize, and reuse code snippets across multiple programming languages with cloud synchronization support.

## Features

### Core Features
- 📝 **Save Code Snippets**: Quickly save selected code with keyboard shortcuts
- 📁 **Organize with Folders**: Create hierarchical folder structure to organize snippets
- 🔍 **Smart Search**: Full-text search across all snippets with fuzzy matching
- 🌍 **Multi-language Support**: Support for 20+ programming languages with syntax highlighting
- 📋 **Quick Access**: Insert snippets directly into your code with one click

### Cloud Synchronization
- ☁️ **Multi-platform Sync**: Support for GitHub, GitLab, and Gitee repositories
- 🔐 **Multiple Authentication**: Token-based and SSH key authentication
- 🔄 **Auto Sync**: Automatic synchronization with configurable intervals
- 🤝 **Conflict Resolution**: Intelligent merge algorithm with manual conflict resolution
- 📦 **Backup & Restore**: Automatic backup before sync operations

### Import & Export
- 📥 **Multiple Formats**: Import from VSCode snippets, JSON, and other formats
- 📤 **Export Options**: Export to various formats for backup or sharing
- 🔄 **Migration Tools**: Seamless migration between storage versions

## Quick Start

1. **Install the Extension**
   - Search for "StarCode Snippets" in VS Code extensions
   - Click Install

2. **Save Your First Snippet**
   - Select code in the editor
   - Use `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac)
   - Enter a name and choose a folder

3. **Access Your Snippets**
   - Open the StarCode Snippets panel in the sidebar
   - Browse, search, and insert snippets
   - Use the search bar for quick filtering

## Cloud Synchronization Setup

### GitHub Setup
1. Create a new repository on GitHub
2. Generate a Personal Access Token with `repo` permissions
3. Open StarCode Snippets Settings
4. Configure GitHub as your provider with repository URL and token

### GitLab Setup
1. Create a new project on GitLab
2. Generate a Personal Access Token with `api` scope
3. Configure GitLab provider in settings

### Gitee Setup
1. Create a new repository on Gitee
2. Generate a Personal Access Token
3. Configure Gitee provider in settings

## Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|---------------|-------|
| Save Snippet | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Open Search | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| Sync to Cloud | `Ctrl+Shift+U` | `Cmd+Shift+U` |

## Advanced Features

### Conflict Resolution
When synchronizing across multiple devices, conflicts may arise. StarCode Snippets provides:
- **Automatic Resolution**: Smart merging for non-conflicting changes
- **Manual Resolution**: Visual diff interface for complex conflicts
- **Backup Protection**: Automatic backup before any destructive operations

### Search Capabilities
- **Full-text Search**: Search within snippet content
- **Tag-based Filtering**: Filter by programming language or custom tags
- **Fuzzy Matching**: Find snippets even with partial or misspelled queries

### Organization
- **Hierarchical Folders**: Unlimited nesting depth
- **Drag & Drop**: Reorder snippets and folders easily
- **Bulk Operations**: Move, delete, or export multiple snippets at once

## Configuration

Access settings through Command Palette (`Ctrl+Shift+P`) → "StarCode Snippets: Open Settings"

### Key Settings
- **Auto Sync**: Enable automatic synchronization
- **Sync Interval**: Configure how often to sync (5-60 minutes)
- **Default Language**: Set default programming language for new snippets
- **Backup Settings**: Configure automatic backup behavior

## Troubleshooting

### Common Issues

**Sync Failures**
- Check network connectivity
- Verify token permissions and expiration
- Ensure repository exists and is accessible

**Performance Issues**
- Large number of snippets may slow down search
- Consider organizing snippets into folders
- Clear cache through settings if needed

**Authentication Errors**
- Regenerate access tokens
- Check repository permissions
- Verify SSH key configuration for SSH authentication

### Support Commands
- `StarCode Snippets: Diagnose Configuration` - Check setup issues
- `StarCode Snippets: Clear Cache` - Reset local cache
- `StarCode Snippets: Export Backup` - Create manual backup

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
1. Clone the repository
2. Run `npm install`
3. Open in VS Code
4. Press F5 to launch extension development host

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

## Support

- 🐛 Report bugs on [GitHub Issues](https://github.com/your-repo/starcode-snippets/issues)
- 💡 Request features through GitHub Issues
- 📖 Check documentation for detailed usage guides
- 💬 Join our community discussions

---

**Boost your coding productivity with StarCode Snippets!** 🚀
