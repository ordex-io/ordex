import type detectEthereumProvider from '@metamask/detect-provider'
import { Actions, BTCNetworkChainIds, Connector, Provider } from '@ordex/btc-react-types'
// TODO: lazy import this large lib
import { AppConfig, UserData, UserSession } from '@stacks/auth'
import { authenticate, AuthOptions, AuthResponsePayload } from '@stacks/connect'

type HiroProvider = Provider & {
  isHiro?: boolean
  isConnected?: () => boolean
  providers?: HiroProvider[]
  get chainId(): string
  get accounts(): string[]
}

export class NoHiroError extends Error {
  public constructor() {
    super('Hiro not installed')
    this.name = NoHiroError.name
    Object.setPrototypeOf(this, NoHiroError.prototype)
  }
}

/**
 * @param options - Options to pass to `@metamask/detect-provider`
 * @param onError - Handler to report errors thrown from eventListeners.
 */
export interface HiroConstructorArgs {
  actions: Actions
  options?: Parameters<typeof detectEthereumProvider>[0]
  onError?: (error: Error) => void
}
// ================== fOXU

export class Hiro extends Connector {
  /** {@inheritdoc Connector.provider} */
  public override provider?: HiroProvider

  private readonly options?: Parameters<typeof detectEthereumProvider>[0]
  private eagerConnection?: Promise<void>

  public userData: UserData | undefined
  public authResponse: AuthResponsePayload | undefined
  public appPrivateKey
  public appConfig: AppConfig
  public userSession: UserSession
  public authOptions: AuthOptions

  constructor({ actions, options, onError }: HiroConstructorArgs) {
    super(actions, onError)
    this.options = options

    this.appConfig = new AppConfig(['store_write', 'publish_data'])
    // this.appConfig = new AppConfig(['store_write', 'publish_data'], document.location.href)
    this.userSession = new UserSession({ appConfig: this.appConfig })

    this.authOptions = {
      manifestPath: '/manifest.json',
      // redirectTo: '/',
      userSession: this.userSession,
      onFinish: (e) => this.onFinish(e),
      onCancel: this.onCancel,
      appDetails: {
        name: 'Ordex.ai',
        icon: '/icons/icon-384x384.png',
      },
    }

    this.connectEagerly = this.connectEagerly.bind(this)
    this.activate = this.activate.bind(this)
    this.deactivate = this.deactivate.bind(this)
    this.signPSBT = this.signPSBT.bind(this)
  }

  private async finalize() {
    // here, this.userData must be available
    try {
      const ordinalAddress = this.userData?.profile.btcAddress.p2tr.mainnet
      if (!ordinalAddress) {
        throw new Error('Unable to fetch Ordinal address from Hiro wallet. Disconnect and try again.')
      }
      const accounts = [ordinalAddress]
      const chainId = BTCNetworkChainIds.BTC
      return this.actions.update({ chainId: chainId, accounts })
    } catch (e) {
      this.onError?.(e as Error)
      throw e
    }
  }

  public async onFinish({ userSession, authResponse }) {
    const userData = userSession.loadUserData()
    this.appPrivateKey = userData.appPrivateKey
    this.authResponse = authResponse
    this.userData = userData
    this.finalize()
  }

  public async onCancel() {
    console.log('popup closed!')
  }

  private async isomorphicInitialize(): Promise<void> {
    if (this.eagerConnection) return

    return (this.eagerConnection = (async (m) => {
      if (this.userSession?.isUserSignedIn()) {
        this.userData = this.userSession.loadUserData()
        this.appPrivateKey = this.userData.appPrivateKey
      } else {
        if (this.userSession?.isSignInPending()) {
          this.userData = await this.userSession.handlePendingSignIn()
          this.appPrivateKey = this.userData.appPrivateKey
        }
      }

      // const provider = await m.default(this.options)
      // if (provider) {
      //   this.provider = provider as HiroProvider

      //   this.provider.on('connect', ({ chainId }: ProviderConnectInfo): void => {
      //     this.actions.update({ chainId: parseChainId(chainId) })
      //   })

      //   this.provider.on('disconnect', (error: ProviderRpcError): void => {
      //     // 1013 indicates that MetaMask is attempting to reestablish the connection
      //     // https://github.com/MetaMask/providers/releases/tag/v8.0.0
      //     if (error.code === 1013) {
      //       console.debug('Hiro logged connection error 1013: "Try again later"')
      //       return
      //     }
      //     this.actions.resetState()
      //     this.onError?.(error)
      //   })

      //   // this.provider.on('chainChanged', (chainId: string): void => {
      //   //   this.actions.update({ chainId: parseChainId(chainId) })
      //   // })

      //   this.provider.on('accountsChanged', (accounts: string[]): void => {
      //     if (accounts.length === 0) {
      //       // handle this edge case by disconnecting
      //       this.actions.resetState()
      //     } else {
      //       this.actions.update({ accounts })
      //     }
      //   })
      // }
    })())
  }

  /** {@inheritdoc Connector.connectEagerly} */
  public override async connectEagerly(): Promise<void> {
    const cancelActivation = this.actions.startActivation()

    try {
      await this.isomorphicInitialize()
      if (!this.userData) {
        await authenticate(this.authOptions)
      } else {
        this.finalize()
      }
    } catch (error) {
      await this.deactivate()
      cancelActivation()
      throw error
    }
  }

  /**
   * Initiates a connection.
   *
   * @param desiredChainIdOrChainParameters - If defined, indicates the desired chain to connect to. If the user is
   * already connected to this chain, no additional steps will be taken. Otherwise, the user will be prompted to switch
   * to the chain, if one of two conditions is met: either they already have it added in their extension, or the
   * argument is of type AddEthereumChainParameter, in which case the user will be prompted to add the chain with the
   * specified parameters first, before being prompted to switch.
   */
  public async activate(desiredChainId?: number): Promise<void> {
    let cancelActivation: () => void
    // if (!this.provider?.isConnected?.()) cancelActivation = this.actions.startActivation()
    if (!this.userSession?.isUserSignedIn?.()) cancelActivation = this.actions.startActivation()
    else {
      // already signed in
      console.log('hiro is already connected')
    }

    try {
      await this.isomorphicInitialize()
      if (!this.userData) await authenticate(this.authOptions)
      else {
        this.finalize()
      }
    } catch (error) {
      await this.deactivate()
      // cancelActivation()
      throw error
    }
  }

  public override deactivate(): void {
    this.userSession?.signUserOut()
    this.actions.resetState()
    this.provider = undefined
    this.eagerConnection = undefined
  }

  public override signPSBT(psbtHex) {
    if (!this.userSession) {
      // not found.  throw error
      throw new NoHiroError()
    }

    // return this.customProvider.signPsbt(psbtHex)
    /*
    return new Promise((resolve, reject) => {
      openPsbtRequestPopup({
        appDetails: {
          name: 'Ordex',
          icon: window.location.origin + '/img/favicon/apple-touch-icon.png',
        },
        hex: base64ToHex(psbtBase64),
        network: Object.getPrototypeOf(connect.getDefaultPsbtRequestOptions({}).network.__proto__.constructor).fromName(
          'mainnet'
        ),
        allowedSighash: [0x01, 0x02, 0x03, 0x81, 0x82, 0x83],
        signAtIndex: range(bitcoin.Psbt.fromBase64(psbtBase64).inputCount),
        onFinish: (data) => {
          resolve(data.hex)
        },
        onCancel: () => {
          reject(new Error('Hiro wallet canceled signing request'))
        },
      })
    })
    */
  }
}
