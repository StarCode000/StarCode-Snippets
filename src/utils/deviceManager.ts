import * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as os from 'os'

export class DeviceManager {
  private static readonly DEVICE_ID_KEY = 'starcode-snippets.deviceId'
  private static readonly DEVICE_NAME_KEY = 'starcode-snippets.deviceName'

  /**
   * 获取设备唯一标识码
   */
  public static getDeviceId(context?: vscode.ExtensionContext): string {
    if (context) {
      // 从扩展存储中获取已保存的设备ID
      let deviceId = context.globalState.get<string>(this.DEVICE_ID_KEY)

      if (!deviceId) {
        // 生成新的设备ID
        deviceId = this.generateDeviceId()
        context.globalState.update(this.DEVICE_ID_KEY, deviceId)
      }

      return deviceId
    } else {
      // 如果没有context，生成临时ID
      return this.generateDeviceId()
    }
  }

  /**
   * 获取设备友好名称
   */
  public static getDeviceName(context?: vscode.ExtensionContext): string {
    if (context) {
      // 从扩展存储中获取已保存的设备名称
      let deviceName = context.globalState.get<string>(this.DEVICE_NAME_KEY)

      if (!deviceName) {
        // 生成新的设备名称
        deviceName = this.generateDeviceName()
        context.globalState.update(this.DEVICE_NAME_KEY, deviceName)
      }

      return deviceName
    } else {
      // 如果没有context，生成临时名称
      return this.generateDeviceName()
    }
  }

  /**
   * 获取设备标识码（短格式，用于历史记录）
   */
  public static getDeviceTag(context?: vscode.ExtensionContext): string {
    const deviceId = this.getDeviceId(context)
    // 取前8位作为短标识
    return deviceId.substring(0, 8)
  }

  /**
   * 生成设备唯一标识码
   */
  private static generateDeviceId(): string {
    // 基于机器信息生成稳定的设备ID
    const machineInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      userInfo: os.userInfo().username,
      // 添加一些随机性，确保唯一性
      random: Math.random().toString(36).substring(2, 15),
    }

    const hash = crypto.createHash('sha256').update(JSON.stringify(machineInfo), 'utf8').digest('hex')

    return hash
  }

  /**
   * 生成设备友好名称
   */
  private static generateDeviceName(): string {
    const hostname = os.hostname()
    const username = os.userInfo().username
    const platform = os.platform()

    // 生成类似 "username@hostname-win32" 的格式
    return `${username}@${hostname}-${platform}`
  }

  /**
   * 重置设备标识（用于测试或重新生成）
   */
  public static resetDeviceId(context: vscode.ExtensionContext): void {
    context.globalState.update(this.DEVICE_ID_KEY, undefined)
    context.globalState.update(this.DEVICE_NAME_KEY, undefined)
  }

  /**
   * 获取设备信息摘要
   */
  public static getDeviceInfo(context?: vscode.ExtensionContext): {
    deviceId: string
    deviceTag: string
    deviceName: string
    hostname: string
    platform: string
    arch: string
  } {
    return {
      deviceId: this.getDeviceId(context),
      deviceTag: this.getDeviceTag(context),
      deviceName: this.getDeviceName(context),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    }
  }
}
