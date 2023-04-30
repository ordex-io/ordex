/**
 * https://github.com/secretkeylabs/sats-connect-example/blob/main/src/dashboard.js
 */
import type detectEthereumProvider from '@metamask/detect-provider'
import { Actions, AddEthereumChainParameter, BTCNetworkChainIds, Connector, Provider } from '@ordex/btc-react-types'
import { createUnsecuredToken, Json } from 'jsontokens'
import { AddressPurposes, BitcoinProvider } from 'sats-connect'

type XverseProvider = Provider & BitcoinProvider

export class NoXverseError extends Error {
  public constructor() {
    super('Xverse not installed')
    this.name = NoXverseError.name
    Object.setPrototypeOf(this, NoXverseError.prototype)
  }
}

/**
 * @param options - Options to pass to `@metamask/detect-provider`
 * @param onError - Handler to report errors thrown from eventListeners.
 */
export interface XverseConstructorArgs {
  actions: Actions
  options?: Parameters<typeof detectEthereumProvider>[0]
  onError?: (error: Error) => void
}

function getChainIdFromNetwork(network: string) {
  const chainId =
    network === 'livenet' || network === 'mainnet'
      ? BTCNetworkChainIds.BTC
      : network === 'testnet'
      ? BTCNetworkChainIds.BTCSIGNET
      : BTCNetworkChainIds.UNKNOWN
  return chainId
}

export class Xverse extends Connector {
  /** {@inheritdoc Connector.provider} */
  public override provider?: XverseProvider

  private readonly options?: Parameters<typeof detectEthereumProvider>[0]
  private eagerConnection?: Promise<void>

  private addressOptions // : GetAddressPayload
  private addressResponse

  constructor({ actions, options, onError }: XverseConstructorArgs) {
    super(actions, onError)
    this.options = options
    this.addressOptions = {
      // purposes: ['ordinals', 'payment'],
      purposes: [AddressPurposes.ORDINALS], // for now just request ordinal address
      message: 'Address for receiving Ordinals',
      network: {
        type: 'Mainnet',
      },
    }

    this.connectEagerly = this.connectEagerly.bind(this)
    this.activate = this.activate.bind(this)
    this.deactivate = this.deactivate.bind(this)
    this.signPSBT = this.signPSBT.bind(this)
  }

  private connectListener = (param) => {}

  private disconnectListener = (error) => {
    this.actions.resetState()
    if (error) this.onError?.(error)
  }

  private networkChangedListener = (network: string): void => {
    const chainId = getChainIdFromNetwork(network)
    if (chainId === BTCNetworkChainIds.UNKNOWN) {
      this.onError?.(new Error('Unknown chain id ' + network))
    }
    this.actions.update({
      chainId,
    })
  }

  private accountsChangedListener = (accounts: string[]): void => {
    if (accounts.length === 0) {
      // handle this edge case by disconnecting
      this.actions.resetState()
    } else {
      this.actions.update({ accounts })
    }
  }

  private async isomorphicInitialize(): Promise<void> {
    if (this.eagerConnection) return this.eagerConnection

    const provider = (window as any)?.BitcoinProvider
    if (!provider) {
      // not found.  throw error
      throw new NoXverseError()
    }

    return (this.eagerConnection = import('sats-connect').then(async (m) => {
      this.provider = provider as XverseProvider

      // return provider
      //   .on('connect', this.connectListener)
      //   .on('disconnect', this.disconnectListener)
      //   .on('networkChanged', this.networkChangedListener)
      //   .on('accountsChanged', this.accountsChangedListener)
    }))
  }

  /** {@inheritdoc Connector.connectEagerly} */
  public override async connectEagerly(): Promise<void> {
    const cancelActivation = this.actions.startActivation()

    try {
      await this.isomorphicInitialize()
      if (!this.provider) return cancelActivation()

      // Wallets may resolve eth_chainId and hang on eth_accounts pending user interaction, which may include changing
      // chains; they should be requested serially, with accounts first, so that the chainId can settle.

      const request = createUnsecuredToken(this.addressOptions as unknown as Json)
      this.addressResponse = await this.provider.connect(request)
      const accounts = this.addressResponse.addresses.map((addr) => addr.address)
      this.accountsChangedListener(accounts)
      const network = 'mainnet'
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
    // if (!this.provider?.isConnected?.()) cancelActivation = this.actions.startActivation()
    if (!this.addressResponse) cancelActivation = this.actions.startActivation()

    return this.isomorphicInitialize()
      .then(async () => {
        if (!this.provider) throw new NoXverseError()
        const request = createUnsecuredToken(this.addressOptions as unknown as Json)
        this.addressResponse = await this.provider.connect(request)
        const accounts = this.addressResponse.addresses.map((addr) => addr.address)
        this.accountsChangedListener(accounts)
        const network = 'mainnet'
        const chainId = getChainIdFromNetwork(network)
        this.actions.update({ chainId, accounts })
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(err)
        cancelActivation?.()
        this.onError?.(error)
        throw error
      })
  }

  public override deactivate(): void {
    this.actions.resetState()
    this.provider = undefined
    this.eagerConnection = undefined
  }

  public override signPSBT(psbtHex) {
    debugger
    if (!this.provider) {
      // not found.  throw error
      throw new NoXverseError()
    }

    return this.provider.signTransaction(psbtHex)
  }
}
