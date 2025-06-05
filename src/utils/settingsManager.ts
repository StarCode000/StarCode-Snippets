import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus, GitPlatformConfig, MultiPlatformCloudSyncConfig } from '../types/types'
import { PathUtils } from './pathUtils'
import * as crypto from 'crypto'

export class SettingsManager {
  private static readonly MULTI_PLATFORM_CONFIG_KEY = 'starcode-snippets.multiPlatformCloudSync'
  private static readonly STATUS_KEY = 'starcode-snippets.cloudSyncStatus'
  private static extensionContext: vscode.ExtensionContext | null = null
  private static notifiedPathAdjustments = new Set<string>() // 记录已通知的路径调整

  /**
   * 获取默认的云端同步配置（向后兼容）
   */
  private static getDefaultConfig(): CloudSyncConfig {
    return {
      provider: 'github',
      repositoryUrl: '',
      token: '',
      localPath: PathUtils.getDefaultLocalRepoPath(), // 使用跨平台默认路径
      defaultBranch: 'main',
      authenticationMethod: 'token',
      sshKeyPath: '',
      autoSync: false,
      syncInterval: 15, // 15分钟
      commitMessageTemplate: 'Sync snippets: {timestamp}',
    }
  }

  /**
   * 获取默认的多平台云端同步配置
   */
  private static getDefaultMultiPlatformConfig(): MultiPlatformCloudSyncConfig {
    return {
      platforms: [],
      autoSync: false,
      syncInterval: 15, // 15分钟
      activeConfigId: null
    }
  }

  /**
   * 获取默认的Git平台配置
   */
  private static getDefaultPlatformConfig(provider: 'github' | 'gitlab' | 'gitee' = 'github'): GitPlatformConfig {
    const platformName = `${provider.charAt(0).toUpperCase()}${provider.slice(1)} 配置`;
    
    return {
      id: crypto.randomUUID(), // 生成唯一ID
      name: platformName,
      provider: provider,
      repositoryUrl: '',
      token: '',
      localPath: '', // 使用空路径，系统自动管理编辑器特定路径
      defaultBranch: 'main',
      authenticationMethod: 'token',
      sshKeyPath: '',
      commitMessageTemplate: 'Sync snippets: {timestamp}',
      isActive: false
    }
  }

  /**
   * 获取默认的云端同步状态
   */
  private static getDefaultStatus(): CloudSyncStatus {
    return {
      isConnected: false,
      lastSyncTime: null,
      lastError: null,
      isSyncing: false,
    }
  }

  /**
   * 获取云端同步配置（从多平台配置中获取当前激活的配置）
   */
  static getCloudSyncConfig(): CloudSyncConfig {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    
    // 如果有激活的平台配置，使用它
    if (multiConfig.platforms.length > 0 && multiConfig.activeConfigId) {
      const activeConfig = multiConfig.platforms.find(p => p.id === multiConfig.activeConfigId);
      if (activeConfig) {
        return this.convertPlatformConfigToLegacy(activeConfig, multiConfig);
      }
    }
    
    // 如果没有激活配置但有平台配置，使用第一个
    if (multiConfig.platforms.length > 0) {
      return this.convertPlatformConfigToLegacy(multiConfig.platforms[0], multiConfig);
    }
    
    // 如果没有任何配置，返回默认配置
    return this.getDefaultConfig();
  }

  /**
   * 将平台配置转换为旧版配置格式（向后兼容）
   */
  private static convertPlatformConfigToLegacy(
    platformConfig: GitPlatformConfig, 
    multiConfig: MultiPlatformCloudSyncConfig
  ): CloudSyncConfig {
    return {
      provider: platformConfig.provider,
      repositoryUrl: platformConfig.repositoryUrl,
      token: platformConfig.token,
      localPath: platformConfig.localPath || '',
      defaultBranch: platformConfig.defaultBranch,
      authenticationMethod: platformConfig.authenticationMethod,
      sshKeyPath: platformConfig.sshKeyPath,
      autoSync: multiConfig.autoSync,
      syncInterval: multiConfig.syncInterval,
      commitMessageTemplate: platformConfig.commitMessageTemplate
    };
  }

  /**
   * 获取多平台云端同步配置
   */
  static getMultiPlatformCloudSyncConfig(): MultiPlatformCloudSyncConfig {
    const config = vscode.workspace.getConfiguration().get<MultiPlatformCloudSyncConfig>(this.MULTI_PLATFORM_CONFIG_KEY);
    const mergedConfig = { ...this.getDefaultMultiPlatformConfig(), ...config };
    
    // 清理无效的平台配置
    if (mergedConfig.platforms && mergedConfig.platforms.length > 0) {
      const originalLength = mergedConfig.platforms.length;
      
      mergedConfig.platforms = mergedConfig.platforms.filter(platform => {
        // 过滤掉无效的平台配置
        const isValid = platform.provider && 
                       ['github', 'gitlab', 'gitee'].includes(platform.provider) &&
                       platform.id && 
                       platform.name;
        
        if (!isValid) {
          // console.log(`清理无效的平台配置: ${platform.provider || '未知'} - ${platform.name || '未命名'}`);
        }
        
        return isValid;
      }).map(platform => {
        // 检查并处理本地路径的跨平台兼容性
        if (platform.localPath && platform.localPath.trim() !== '') {
          // 如果是默认路径标识符，跳过所有处理，保持原样
          if (PathUtils.isDefaultPathToken(platform.localPath)) {
            // 保持默认路径标识符不变
            return platform;
          }
          
          // 先检查路径兼容性
          const pathResult = PathUtils.processImportedPath(platform.localPath, platform.provider);
          
          if (pathResult.wasModified) {
            // 路径不兼容，已自动调整为默认路径标识符
            platform.localPath = pathResult.processedPath;
            console.log(`配置读取时检测到不兼容路径，已自动调整：${platform.provider} - ${pathResult.reason}`);
            
            // 避免重复通知同一平台的路径调整
            const notificationKey = `${platform.provider}-path-adjusted`;
            if (!this.notifiedPathAdjustments.has(notificationKey)) {
              this.notifiedPathAdjustments.add(notificationKey);
              
              // 显示通知给用户
              vscode.window.showWarningMessage(
                `检测到不兼容的本地路径配置，已自动调整：\n${platform.provider.toUpperCase()} - ${pathResult.reason}`,
                '我知道了'
              );
            }
          } else {
            // 路径兼容，进行标准化处理
            platform.localPath = PathUtils.normalizePath(platform.localPath);
          }
        }
        return platform;
      });
      
      // 如果清理了无效配置，检查激活配置是否还有效
      if (originalLength !== mergedConfig.platforms.length) {
        // console.log(`清理了 ${originalLength - mergedConfig.platforms.length} 个无效的平台配置`);
        
        // 检查当前激活的配置是否还存在
        if (mergedConfig.activeConfigId) {
          const activeExists = mergedConfig.platforms.find(p => p.id === mergedConfig.activeConfigId);
          if (!activeExists && mergedConfig.platforms.length > 0) {
            // 激活第一个有效配置
            mergedConfig.activeConfigId = mergedConfig.platforms[0].id;
            mergedConfig.platforms[0].isActive = true;
            // console.log(`重新激活配置: ${mergedConfig.platforms[0].provider} - ${mergedConfig.platforms[0].name}`);
          } else if (!activeExists) {
            mergedConfig.activeConfigId = null;
            // console.log('没有有效的平台配置可激活');
          }
        }
      }
    }
    
    return mergedConfig;
  }

  /**
   * 保存多平台云端同步配置
   */
  static async saveMultiPlatformCloudSyncConfig(config: MultiPlatformCloudSyncConfig): Promise<void> {
    // 在保存前检查路径冲突
    const pathConflicts = PathUtils.checkPathConflicts(config.platforms);
    
    if (pathConflicts.hasConflicts) {
      // 构建冲突信息
      const conflictMessages = pathConflicts.conflicts.map(conflict => {
        const platformNames = conflict.platforms.map(p => `${p.name} (${p.provider})`).join('、');
        return `路径 "${conflict.path}" 被以下平台重复使用：${platformNames}`;
      }).join('\n\n');
      
      // 构建建议信息
      const suggestionMessages = pathConflicts.suggestions.map(suggestion => {
        const platform = config.platforms.find(p => p.id === suggestion.platformId);
        return `${platform?.name} (${platform?.provider}) 建议使用：${suggestion.suggestedPath}`;
      }).join('\n');
      
      const errorMessage = `检测到本地仓库路径冲突：\n\n${conflictMessages}\n\n建议路径：\n${suggestionMessages}`;
      
      console.error('SettingsManager: 路径冲突检查失败', errorMessage);
      
      // 显示错误信息给用户
      const action = await vscode.window.showErrorMessage(
        '保存配置失败：多个平台使用了相同的本地仓库路径，这可能导致数据冲突。',
        { modal: true },
        '查看详情',
        '忽略并继续'
      );
      
      if (action === '查看详情') {
        await vscode.window.showInformationMessage(errorMessage, { modal: true });
        throw new Error('配置保存被用户取消：存在路径冲突');
      } else if (action !== '忽略并继续') {
        throw new Error('配置保存被用户取消：存在路径冲突');
      }
      
      console.warn('SettingsManager: 用户选择忽略路径冲突并继续保存');
    }
    
    await vscode.workspace.getConfiguration().update(
      this.MULTI_PLATFORM_CONFIG_KEY, 
      config, 
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * 带重试机制的多平台配置保存
   */
  static async saveMultiPlatformCloudSyncConfigWithRetry(config: MultiPlatformCloudSyncConfig, maxRetries: number = 3): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // console.log(`SettingsManager: 尝试保存多平台配置 (第 ${attempt} 次)`);
        
        // 添加短暂延迟，避免并发冲突
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
        
        // 在保存前检查配置是否已注册
        if (attempt === 1) {
          await this.ensureConfigurationAvailable();
        }
        
        await vscode.workspace.getConfiguration().update(
          this.MULTI_PLATFORM_CONFIG_KEY, 
          config, 
          vscode.ConfigurationTarget.Global
        );
        

        
        // console.log(`SettingsManager: 多平台配置保存成功 (第 ${attempt} 次尝试)`);
        return; // 成功，退出重试循环
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`SettingsManager: 保存多平台配置失败 (第 ${attempt} 次尝试):`, lastError.message);
        
        // 如果是配置未注册错误，等待配置系统初始化
        if (lastError.message.includes('没有注册配置') || lastError.message.includes('NoPermissions')) {
          if (attempt < maxRetries) {
            // console.log(`检测到配置注册问题，等待 ${attempt * 1000}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            // 在重试前再次检查配置
            await this.ensureConfigurationAvailable();
          }
        }
        // 如果是权限错误，等待更长时间再重试
        else if (lastError.message.includes('EPERM')) {
          if (attempt < maxRetries) {
            // console.log(`检测到权限错误，等待 ${attempt * 1000}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          }
        }
      }
    }
    
    // 所有重试都失败了
    const errorMessage = `保存多平台配置失败，已重试 ${maxRetries} 次。最后错误: ${lastError?.message || '未知错误'}`;
    console.error('SettingsManager:', errorMessage);
    throw new Error(errorMessage);
  }

  /**
   * 保存云端同步配置（转换为多平台配置格式）
   */
  static async saveCloudSyncConfig(config: CloudSyncConfig): Promise<void> {
    // console.log('SettingsManager: 保存配置', config.provider, config.repositoryUrl ? '(有仓库URL)' : '(无仓库URL)');
    
    // 直接转换为多平台配置并保存
    await this.syncLegacyConfigToMultiPlatform(config);
  }



  /**
   * 批量保存多个平台的配置（用于前端缓存的配置批量保存）
   */
  static async saveBatchPlatformConfigs(configs: { [provider: string]: CloudSyncConfig }): Promise<number> {
    let savedCount = 0;
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    
    // console.log('SettingsManager: 开始批量保存配置');
    
    // 用于保存自动同步设置的变量
    let autoSyncConfig: { autoSync: boolean; syncInterval: number } | null = null;
    
    for (const [provider, config] of Object.entries(configs)) {
      if (!config || !provider || !['github', 'gitlab', 'gitee'].includes(provider) || !config.repositoryUrl?.trim()) {
        // console.log(`跳过无效配置: ${provider}`);
        continue;
      }
      
      try {
        // 保存自动同步设置（从任何一个有效配置中获取，因为这是全局设置）
        if (!autoSyncConfig) {
          autoSyncConfig = {
            autoSync: config.autoSync || false,
            syncInterval: config.syncInterval || 15
          };
        }
        
        // 查找是否已存在相同平台的配置
        const existingConfigIndex = multiConfig.platforms.findIndex(p => p.provider === provider);
        
        if (existingConfigIndex !== -1) {
          // 更新现有配置
          multiConfig.platforms[existingConfigIndex] = {
            ...multiConfig.platforms[existingConfigIndex],
            provider: config.provider,
            repositoryUrl: config.repositoryUrl,
            token: config.token,
            localPath: config.localPath,
            defaultBranch: config.defaultBranch,
            authenticationMethod: config.authenticationMethod,
            sshKeyPath: config.sshKeyPath,
            commitMessageTemplate: config.commitMessageTemplate
          };
          // console.log(`SettingsManager: 更新了 ${provider} 配置`);
        } else {
          // 创建新配置
          const newConfig = this.getDefaultPlatformConfig(provider as any);
          newConfig.repositoryUrl = config.repositoryUrl;
          newConfig.token = config.token;
          newConfig.localPath = config.localPath;
          newConfig.defaultBranch = config.defaultBranch;
          newConfig.authenticationMethod = config.authenticationMethod;
          newConfig.sshKeyPath = config.sshKeyPath;
          newConfig.commitMessageTemplate = config.commitMessageTemplate;
          newConfig.name = `${provider.charAt(0).toUpperCase()}${provider.slice(1)} 配置`;
          
          multiConfig.platforms.push(newConfig);
          // console.log(`SettingsManager: 创建了 ${provider} 配置`);
        }
        
        savedCount++;
      } catch (error) {
        console.error(`保存 ${provider} 配置失败:`, error);
      }
    }
    
    if (savedCount > 0) {
      // 更新全局自动同步设置
      if (autoSyncConfig) {
        multiConfig.autoSync = autoSyncConfig.autoSync;
        multiConfig.syncInterval = autoSyncConfig.syncInterval;
        // console.log(`SettingsManager: 更新自动同步设置 - autoSync: ${autoSyncConfig.autoSync}, syncInterval: ${autoSyncConfig.syncInterval}`);
      }
      
      // 使用重试机制保存多平台配置
      await this.saveMultiPlatformCloudSyncConfigWithRetry(multiConfig);
      // console.log(`SettingsManager: 批量保存完成，共保存 ${savedCount} 个平台配置`);
    }
    
    return savedCount;
  }

  /**
   * 将旧版配置同步到多平台配置中
   */
  private static async syncLegacyConfigToMultiPlatform(legacyConfig: CloudSyncConfig): Promise<void> {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    
    if (!legacyConfig.provider || !['github', 'gitlab', 'gitee'].includes(legacyConfig.provider)) {
      // 如果没有provider或provider无效，不做处理
      // console.log('跳过无效的provider:', legacyConfig.provider);
      return;
    }
    
    // 查找是否已存在相同平台的配置
    const existingConfigIndex = multiConfig.platforms.findIndex(p => p.provider === legacyConfig.provider);
    
    if (existingConfigIndex !== -1) {
      // 如果已存在相同平台的配置，更新它
      // console.log('SettingsManager: 更新现有平台配置', legacyConfig.provider);
      multiConfig.platforms[existingConfigIndex] = {
        ...multiConfig.platforms[existingConfigIndex],
        provider: legacyConfig.provider,
        repositoryUrl: legacyConfig.repositoryUrl,
        token: legacyConfig.token,
        localPath: legacyConfig.localPath,
        defaultBranch: legacyConfig.defaultBranch,
        authenticationMethod: legacyConfig.authenticationMethod,
        sshKeyPath: legacyConfig.sshKeyPath,
        commitMessageTemplate: legacyConfig.commitMessageTemplate
      };
      
      // 设置为激活配置
      multiConfig.platforms = multiConfig.platforms.map(p => ({ ...p, isActive: false }));
      multiConfig.platforms[existingConfigIndex].isActive = true;
      multiConfig.activeConfigId = multiConfig.platforms[existingConfigIndex].id;
    } else {
      // 如果不存在，创建新配置
      // console.log('SettingsManager: 创建新平台配置', legacyConfig.provider);
      const newConfig = this.getDefaultPlatformConfig(legacyConfig.provider);
      newConfig.repositoryUrl = legacyConfig.repositoryUrl;
      newConfig.token = legacyConfig.token;
      newConfig.localPath = legacyConfig.localPath;
      newConfig.defaultBranch = legacyConfig.defaultBranch;
      newConfig.authenticationMethod = legacyConfig.authenticationMethod;
      newConfig.sshKeyPath = legacyConfig.sshKeyPath;
      newConfig.commitMessageTemplate = legacyConfig.commitMessageTemplate;
      newConfig.isActive = true;
      newConfig.name = `${legacyConfig.provider.charAt(0).toUpperCase()}${legacyConfig.provider.slice(1)} 配置`;
      
      // 将其他配置设为非激活
      multiConfig.platforms = multiConfig.platforms.map(p => ({ ...p, isActive: false }));
      
      multiConfig.platforms.push(newConfig);
      multiConfig.activeConfigId = newConfig.id;
    }
    
    // 更新自动同步设置
    multiConfig.autoSync = legacyConfig.autoSync;
    multiConfig.syncInterval = legacyConfig.syncInterval;
    
    // 保存多平台配置
    await this.saveMultiPlatformCloudSyncConfig(multiConfig);
  }

  /**
   * 获取云端同步状态
   */
  static getCloudSyncStatus(): CloudSyncStatus {
    const status = vscode.workspace.getConfiguration().get<CloudSyncStatus>(this.STATUS_KEY);
    return { ...this.getDefaultStatus(), ...status };
  }

  /**
   * 保存云端同步状态
   */
  static async saveCloudSyncStatus(status: CloudSyncStatus): Promise<void> {
    await vscode.workspace.getConfiguration().update(this.STATUS_KEY, status, vscode.ConfigurationTarget.Global);
  }

  /**
   * 添加新的Git平台配置
   */
  static async addPlatformConfig(
    provider: 'github' | 'gitlab' | 'gitee' = 'github', 
    makeActive: boolean = true
  ): Promise<GitPlatformConfig> {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    const newConfig = this.getDefaultPlatformConfig(provider);
    
    if (makeActive) {
      // 将所有平台配置设为非激活
      multiConfig.platforms = multiConfig.platforms.map(p => ({ ...p, isActive: false }));
      newConfig.isActive = true;
      multiConfig.activeConfigId = newConfig.id;
    }
    
    multiConfig.platforms.push(newConfig);
    await this.saveMultiPlatformCloudSyncConfig(multiConfig);
    
    return newConfig;
  }

  /**
   * 更新Git平台配置
   */
  static async updatePlatformConfig(config: GitPlatformConfig): Promise<void> {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    const index = multiConfig.platforms.findIndex(p => p.id === config.id);
    
    if (index !== -1) {
      multiConfig.platforms[index] = config;
      
      // 如果该配置被标记为激活，更新激活的配置ID
      if (config.isActive) {
        // 将其他平台设为非激活
        multiConfig.platforms = multiConfig.platforms.map(p => 
          p.id !== config.id ? { ...p, isActive: false } : p
        );
        multiConfig.activeConfigId = config.id;
      }
      
      await this.saveMultiPlatformCloudSyncConfig(multiConfig);
    }
  }

  /**
   * 删除Git平台配置
   */
  static async deletePlatformConfig(configId: string): Promise<void> {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    const index = multiConfig.platforms.findIndex(p => p.id === configId);
    
    if (index !== -1) {
      const deletedPlatform = multiConfig.platforms[index];
      // console.log(`删除平台配置: ${deletedPlatform.provider || '未知'} - ${deletedPlatform.name || '未命名'}`);
      
      multiConfig.platforms.splice(index, 1);
      
      // 如果删除的是当前激活的配置，将activeConfigId设为null或第一个可用配置
      if (multiConfig.activeConfigId === configId) {
        if (multiConfig.platforms.length > 0) {
          // 找到第一个有效的平台配置
          const validPlatform = multiConfig.platforms.find(p => 
            p.provider && ['github', 'gitlab', 'gitee'].includes(p.provider)
          );
          
          if (validPlatform) {
            multiConfig.activeConfigId = validPlatform.id;
            validPlatform.isActive = true;
            // console.log(`激活新的平台配置: ${validPlatform.provider} - ${validPlatform.name}`);
          } else {
            multiConfig.activeConfigId = null;
            // console.log('没有有效的平台配置可激活');
          }
        } else {
          multiConfig.activeConfigId = null;
          // console.log('所有平台配置已删除');
        }
      }
      
      await this.saveMultiPlatformCloudSyncConfig(multiConfig);
    } else {
      console.warn(`未找到要删除的平台配置，ID: ${configId}`);
    }
  }

  /**
   * 获取当前激活的Git平台配置
   */
  static getActivePlatformConfig(): GitPlatformConfig | null {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    
    if (multiConfig.activeConfigId) {
      return multiConfig.platforms.find(p => p.id === multiConfig.activeConfigId) || null;
    }
    
    // 如果没有激活的配置但有平台配置，返回第一个
    if (multiConfig.platforms.length > 0) {
      return multiConfig.platforms[0];
    }
    
    return null;
  }

  /**
   * 激活指定的Git平台配置
   */
  static async activatePlatformConfig(configId: string): Promise<void> {
    const multiConfig = this.getMultiPlatformCloudSyncConfig();
    const configIndex = multiConfig.platforms.findIndex(p => p.id === configId);
    
    if (configIndex !== -1) {
      // 将所有平台设为非激活
      multiConfig.platforms = multiConfig.platforms.map(p => ({ ...p, isActive: false }));
      
      // 激活指定平台
      multiConfig.platforms[configIndex].isActive = true;
      multiConfig.activeConfigId = configId;
      
      await this.saveMultiPlatformCloudSyncConfig(multiConfig);
    }
  }

  /**
   * 验证配置是否完整
   */
  static validateConfig(config: CloudSyncConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!config.provider.trim()) {
      errors.push('Git 平台不能为空')
    } else if (!['github', 'gitlab', 'gitee'].includes(config.provider)) {
      errors.push('不支持的Git平台，只支持GitHub、GitLab、Gitee')
    }

    if (!config.repositoryUrl.trim()) {
      errors.push('仓库 URL 不能为空')
    }

    // 本地路径验证 - 如果用户提供了自定义路径，验证其有效性
    if (config.localPath && config.localPath.trim() !== '') {
      // 如果是默认路径标识符，跳过验证（因为它们总是有效的）
      if (!PathUtils.isDefaultPathToken(config.localPath)) {
        try {
          const normalizedPath = PathUtils.normalizePath(config.localPath)
          // 这里可以添加更严格的路径验证逻辑
          if (!normalizedPath) {
            errors.push('本地仓库路径格式无效')
          }
        } catch (error) {
          errors.push('本地仓库路径格式无效')
        }
      }
    }
    // 注意：不再强制要求用户提供路径，系统会自动使用默认路径

    if (!config.defaultBranch.trim()) {
      errors.push('默认分支名不能为空')
    }

    // 验证认证方式相关字段
    if (config.authenticationMethod === 'token' && !config.token.trim()) {
      errors.push('使用令牌认证时，访问令牌不能为空')
    }

    if (config.authenticationMethod === 'ssh' && !config.sshKeyPath.trim()) {
      errors.push('使用SSH认证时，SSH密钥路径不能为空')
    }

    if (config.syncInterval <= 0) {
      errors.push('自动同步间隔必须大于0分钟')
    }

    if (config.syncInterval > 1440) {
      errors.push('自动同步间隔不能超过1440分钟（24小时）')
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * 验证Git平台配置是否完整
   */
  static validatePlatformConfig(config: GitPlatformConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!config.name.trim()) {
      errors.push('配置名称不能为空')
    }

    if (!config.provider.trim()) {
      errors.push('Git 平台不能为空')
    }

    if (!config.repositoryUrl.trim()) {
      errors.push('仓库 URL 不能为空')
    }

    // 本地路径验证 - 如果用户提供了自定义路径，验证其有效性
    if (config.localPath && config.localPath.trim() !== '') {
      // 如果是默认路径标识符，跳过验证（因为它们总是有效的）
      if (!PathUtils.isDefaultPathToken(config.localPath)) {
        try {
          const normalizedPath = PathUtils.normalizePath(config.localPath)
          if (!normalizedPath) {
            errors.push('本地仓库路径格式无效')
          }
        } catch (error) {
          errors.push('本地仓库路径格式无效')
        }
      }
    }

    if (!config.defaultBranch.trim()) {
      errors.push('默认分支名不能为空')
    }

    // 验证认证方式相关字段
    if (config.authenticationMethod === 'token' && !config.token.trim()) {
      errors.push('使用令牌认证时，访问令牌不能为空')
    }

    if (config.authenticationMethod === 'ssh' && !config.sshKeyPath.trim()) {
      errors.push('使用SSH认证时，SSH密钥路径不能为空')
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * 迁移旧配置到多平台配置系统（已废弃，因为不再支持旧配置）
   */
  static async migrateToMultiPlatform(): Promise<void> {
    // 由于已经移除了旧配置支持，这个方法现在是空的
    // console.log('迁移方法已废弃，因为不再支持旧配置格式');
  }

  /**
   * 重置配置为默认值
   */
  static async resetConfig(): Promise<void> {
    await this.saveMultiPlatformCloudSyncConfig(this.getDefaultMultiPlatformConfig())
    await this.saveCloudSyncStatus(this.getDefaultStatus())
  }

  /**
   * 设置扩展上下文
   */
  static setExtensionContext(context: vscode.ExtensionContext): void {
    this.extensionContext = context
  }

  /**
   * 获取扩展上下文
   */
  static getExtensionContext(): vscode.ExtensionContext | null {
    return this.extensionContext
  }

  /**
   * 获取有效的本地仓库路径
   * 优先使用编辑器特定路径确保数据隔离
   * 支持默认路径标识符的解析
   */
  static getEffectiveLocalPath(): string {
    // 优先获取激活平台的配置
    const activePlatform = this.getActivePlatformConfig();
    if (activePlatform) {
      // 解析默认路径标识符或使用实际路径，传入扩展上下文
      return PathUtils.resolveDefaultPathToken(
        activePlatform.localPath || '', 
        activePlatform.provider, 
        this.extensionContext || undefined
      );
    }
    
    // 回退到传统配置
    const config = this.getCloudSyncConfig();
    const provider = config.provider as 'github' | 'gitlab' | 'gitee' | undefined;
    
    // 解析默认路径标识符或使用实际路径，传入扩展上下文
    return PathUtils.resolveDefaultPathToken(
      config.localPath || '', 
      provider, 
      this.extensionContext || undefined
    );
  }

  /**
   * 获取路径描述信息，用于UI显示
   * 优先使用编辑器特定的路径描述
   */
  static getLocalPathDescription(): string {
    // 优先获取激活平台的配置
    const activePlatform = this.getActivePlatformConfig();
    if (activePlatform) {
      return PathUtils.getEditorSpecificPathDescription(activePlatform.provider, this.extensionContext || undefined);
    }
    
    // 回退到传统配置
    const config = this.getCloudSyncConfig();
    const provider = config.provider as 'github' | 'gitlab' | 'gitee' | undefined;
    
    return PathUtils.getEditorSpecificPathDescription(provider, this.extensionContext || undefined);
  }

  /**
   * 检查是否使用默认路径
   */
  static isUsingDefaultPath(): boolean {
    // 优先检查激活平台的配置
    const activePlatform = this.getActivePlatformConfig();
    if (activePlatform) {
      return PathUtils.isUsingDefaultPath(activePlatform.localPath || '', activePlatform.provider);
    }
    
    // 回退到传统配置
    const config = this.getCloudSyncConfig();
    const provider = config.provider as 'github' | 'gitlab' | 'gitee' | undefined;
    
    return PathUtils.isUsingDefaultPath(config.localPath || '', provider);
  }

  /**
   * 确保配置在VSCode中可用，处理插件更新后的配置注册延迟问题
   */
  private static async ensureConfigurationAvailable(): Promise<void> {
    const maxWaitTime = 2000; // 最大等待2秒
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const config = vscode.workspace.getConfiguration();
        const configSchema = config.inspect(this.MULTI_PLATFORM_CONFIG_KEY);
        
        if (configSchema && configSchema.defaultValue !== undefined) {
          // 配置已可用
          return;
        }
        
        // 等待50ms后重试
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        // 忽略检查错误，继续等待
      }
    }
    
    // 超时后记录警告但继续执行
    console.warn(`配置 ${this.MULTI_PLATFORM_CONFIG_KEY} 等待超时，可能存在注册延迟`);
  }
}
