/**
 * Inspired by web3-react's metamask connector because Unisat is a fork of metamask
 */
import type detectEthereumProvider from '@metamask/detect-provider'
import { Actions, AddEthereumChainParameter, BTCNetworkChainIds, Connector, Provider } from '@ordex/btc-react-types'

type UnisatProvider = Provider & {
  isUnisat?: boolean
  isConnected?: () => boolean
  getAccounts(): Promise<string[]>
  requestAccounts(): Promise<string[]>
  getPublicKey(): Promise<string>
  getNetwork(): Promise<string>
  switchNetwork(): Promise<void>
  getBalance(): Promise<string>
  sendBitcoin: (psbt: any) => Promise<string>
  signPsbt: (psbt: any) => Promise<any>
  pushPsbt: (psbt: any) => Promise<string>
}

export class NoUnisatError extends Error {
  public constructor() {
    super('Unisat not installed')
    this.name = NoUnisatError.name
    Object.setPrototypeOf(this, NoUnisatError.prototype)
  }
}

/**
 * @param options - Options to pass to `@metamask/detect-provider`
 * @param onError - Handler to report errors thrown from eventListeners.
 */
export interface UnisatConstructorArgs {
  actions: Actions
  options?: Parameters<typeof detectEthereumProvider>[0]
  onError?: (error: Error) => void
}

function getChainIdFromNetwork(network: string) {
  const chainId =
    network === 'livenet'
      ? BTCNetworkChainIds.BTC
      : network === 'testnet'
      ? BTCNetworkChainIds.BTCSIGNET
      : BTCNetworkChainIds.UNKNOWN
  return chainId
}

export class Unisat extends Connector {
  /** {@inheritdoc Connector.provider} */
  public override customProvider?: UnisatProvider

  private readonly options?: Parameters<typeof detectEthereumProvider>[0]
  private eagerConnection?: Promise<void>

  constructor({ actions, options, onError }: UnisatConstructorArgs) {
    super(actions, onError)
    this.options = options

    this.connectEagerly = this.connectEagerly.bind(this)
    this.disconnectListener = this.disconnectListener.bind(this)
    this.activate = this.activate.bind(this)
    this.deactivate = this.deactivate.bind(this)
    this.signPSBT = this.signPSBT.bind(this)
  }

  private connectListener = (param) => {
    // debugger
  }

  private disconnectListener = (error) => {
    // debugger
    this.actions.resetState()
    if (error) this.onError?.(error)
  }

  private networkChangedListener = (network: string): void => {
    // debugger
    const chainId = getChainIdFromNetwork(network)
    if (chainId === BTCNetworkChainIds.UNKNOWN) {
      this.onError?.(new Error('Unknown chain id ' + network))
    }
    this.actions.update({
      chainId,
    })
  }

  private accountsChangedListener = (accounts: string[]): void => {
    // debugger
    if (accounts.length === 0) {
      // handle this edge case by disconnecting
      this.actions.resetState()
    } else {
      this.actions.update({ accounts })
    }
  }

  private async isomorphicInitialize(): Promise<void> {
    if (this.eagerConnection) return this.eagerConnection

    return (this.eagerConnection = (async () => {
      const provider = (window as any)?.unisat
      if (!provider) {
        // not found.  throw error
        throw new NoUnisatError()
      }
      this.customProvider = provider as UnisatProvider

      return provider
        .on('connect', this.connectListener)
        .on('disconnect', this.disconnectListener)
        .on('networkChanged', this.networkChangedListener)
        .on('accountsChanged', this.accountsChangedListener)
    })())
  }

  /** {@inheritdoc Connector.connectEagerly} */
  public override async connectEagerly(): Promise<void> {
    const cancelActivation = this.actions.startActivation()

    try {
      await this.isomorphicInitialize()
      if (!this.customProvider) return cancelActivation()
      // Wallets may resolve eth_chainId and hang on eth_accounts pending user interaction, which may include changing
      // chains; they should be requested serially, with accounts first, so that the chainId can settle.
      const accounts = await this.customProvider.requestAccounts()
      // const accountsGot = await this.customProvider.getAccounts()
      // console.warn({
      //   accounts,
      //   accountsGot,
      // })
      if (!accounts?.length) throw new Error('No accounts returned')
      const network = await this.customProvider.getNetwork()
      const chainId = getChainIdFromNetwork(network)
      this.actions.update({ chainId, accounts })
    } catch (error) {
      console.debug('Could not connect eagerly', error)
      // we should be able to use `cancelActivation` here, but on mobile, metamask emits a 'connect'
      // event, meaning that chainId is updated, and cancelActivation doesn't work because an intermediary
      // update has occurred, so we reset state instead
      this.actions.resetState()
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
  public async activate(desiredChainIdOrChainParameters?: number | AddEthereumChainParameter): Promise<void> {
    let cancelActivation: () => void
    if (!this.customProvider?.isConnected?.()) cancelActivation = this.actions.startActivation()
    return this.isomorphicInitialize()
      .then(async () => {
        // debugger
        if (!this.customProvider) throw new NoUnisatError()
        const accounts = await this.customProvider.requestAccounts()
        this.accountsChangedListener(accounts)
        const network = await this.customProvider.getNetwork()
        const chainId = getChainIdFromNetwork(network)
        this.actions.update({ chainId, accounts })
      })
      .catch((error) => {
        // debugger
        cancelActivation?.()
        this.onError?.(error)
        throw error
      })
  }

  public override deactivate(): void {
    this.actions.resetState()
    this.customProvider = undefined
    this.eagerConnection = undefined
  }

  public override signPSBT(psbtHex) {
    debugger
    if (!this.customProvider) {
      // not found.  throw error
      throw new NoUnisatError()
    }

    return this.customProvider.signPsbt(psbtHex)
  }
}
