import React, {useEffect, useState} from 'react';
import {Connection, PublicKey, clusterApiUrl} from '@solana/web3.js';
import {Program, Provider, web3} from '@project-serum/anchor';
import {MintLayout, TOKEN_PROGRAM_ID, Token} from '@solana/spl-token';
import {Metadata, MetadataProgram} from '@metaplex-foundation/mpl-token-metadata';
import {
    candyMachineProgramV2,
    TOKEN_METADATA_PROGRAM_ID,
    SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
    MAX_NAME_LENGTH,
    MAX_URI_LENGTH,
    MAX_SYMBOL_LENGTH,
    MAX_CREATOR_LEN,
} from './helpers';
import CountdownTimer from "../CountdownTimer";

const {SystemProgram} = web3;
const network = clusterApiUrl(process.env.REACT_APP_SOLANA_NETWORK);
const options = {preflightCommitment: "processed"};


const CandyMachine = ({walletAddress}) => {
    // States
    const [machineStats, setMachineStats] = useState({});
    const [mints, setMints] = useState([]);
    const [isMinting, setIsMinting] = useState(false);
    const [isLoadingMints, setIsLoadingMints] = useState(false);

    // Actions
    const getProvider = () => {
        const connection = new Connection(network, options.preflightCommitment);
        return new Provider(connection, window.solana, options.preflightCommitment);
    }

    const fetchHashTable = async (hash, metadataEnabled) => {
        console.log("Fetching hash table...");
        const connection = new web3.Connection(
            process.env.REACT_APP_SOLANA_RPC_HOST
        );

        const metadataAccounts = await MetadataProgram.getProgramAccounts(
            connection,
            {
                filters: [
                    {
                        memcmp: {
                            offset:
                                1 +
                                32 +
                                32 +
                                4 +
                                MAX_NAME_LENGTH +
                                4 +
                                MAX_URI_LENGTH +
                                4 +
                                MAX_SYMBOL_LENGTH +
                                2 +
                                1 +
                                4 +
                                0 * MAX_CREATOR_LEN,
                            bytes: hash,
                        },
                    },
                ],
            }
        );
        console.log(metadataAccounts);

        const mintHashes = [];

        for (let index = 0; index < metadataAccounts.length; index++) {
            const account = metadataAccounts[index];
            const accountInfo = await connection.getParsedAccountInfo(account.pubkey);
            const metadata = new Metadata(hash.toString(), accountInfo.value);
            if (metadataEnabled) mintHashes.push(metadata.data);
            else mintHashes.push(metadata.data.mint);
        }

        console.log(mintHashes);
        return mintHashes;
    };

    const getMetadata = async (mint) => {
        return (
            await PublicKey.findProgramAddress(
                [
                    Buffer.from('metadata'),
                    TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                    mint.toBuffer(),
                ],
                TOKEN_METADATA_PROGRAM_ID
            )
        )[0];
    };

    const getMasterEdition = async (mint) => {
        return (
            await PublicKey.findProgramAddress(
                [
                    Buffer.from('metadata'),
                    TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                    mint.toBuffer(),
                    Buffer.from('edition'),
                ],
                TOKEN_METADATA_PROGRAM_ID
            )
        )[0];
    };

    const getTokenWallet = async (wallet, mint) => {
        return (
            await web3.PublicKey.findProgramAddress(
                [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
                SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
            )
        )[0];
    };

    const getCandyMachineState = async () => {
        const provider = getProvider();
        const idl = await Program.fetchIdl(candyMachineProgramV2, provider);
        const program = new Program(idl, candyMachineProgramV2, provider);

        const candyMachine = await program.account.candyMachine.fetch(process.env.REACT_APP_CANDY_MACHINE_ID);

        const itemsAvailable = candyMachine.data.itemsAvailable.toNumber();
        const itemsRedeemed = candyMachine.itemsRedeemed.toNumber();
        const itemsRemaining = itemsAvailable - itemsRedeemed;
        const goLiveData = candyMachine.data.goLiveDate.toNumber();
        const goLiveDateTimeString = `${new Date(goLiveData * 1000).toLocaleDateString()} @ ${new Date(goLiveData * 1000).toLocaleTimeString()}`;

        const stats = {
            itemsAvailable,
            itemsRedeemed,
            itemsRemaining,
            goLiveData,
            goLiveDateTimeString
        };
        setMachineStats(stats);
        console.log(stats);

        setIsLoadingMints(true);

        const hashTable = await fetchHashTable(process.env.REACT_APP_CANDY_MACHINE_ID, true);
        if (hashTable.length > 0) {
            const requests = hashTable.map(async (mint) => {
                try {
                    // Get NFT URI
                    const response = await fetch(mint.data.uri);
                    const metadata = await response.json();
                    return metadata.image;
                }
                catch (error) {
                    console.log("Error fetching minted NFT", mint);
                    return null;
                }
            });

            // Wait for all requests to complete and filter those that failed
            const allMints = await Promise.all(requests);
            const filteredMints = allMints.filter(mint => mint !== null);

            setMints(filteredMints);
            console.log("Past minted NFTs:", mints);
        }

        setIsLoadingMints(false);
    };

    const getCandyMachineCreator = async (candyMachine) => {
        const candyMachineID = new PublicKey(candyMachine);
        return await web3.PublicKey.findProgramAddress(
            [Buffer.from('candy_machine'), candyMachineID.toBuffer()],
            candyMachineProgramV2,
        );
    };

    const mintToken = async () => {
        try {
            console.log("Minting NFT...");
            setIsMinting(true);

            // Create an account for our NFT
            const mint = web3.Keypair.generate();
            const token = await getTokenWallet(
                walletAddress.publicKey,
                mint.publicKey
            );

            const metadata = await getMetadata(mint.publicKey);
            const masterEdition = await getMasterEdition(mint.publicKey);
            const rpcHost = process.env.REACT_APP_SOLANA_RPC_HOST;
            const connection = new Connection(rpcHost);
            const rent = await connection.getMinimumBalanceForRentExemption(MintLayout.span);

            const [candyMachineCreator, creatorBump] = await getCandyMachineCreator(process.env.REACT_APP_CANDY_MACHINE_ID);
            const accounts = {
                candyMachine: process.env.REACT_APP_CANDY_MACHINE_ID,
                candyMachineCreator,
                payer: walletAddress.publicKey,  // Person paying for and receiving the NFT
                wallet: process.env.REACT_APP_TREASURY_ADDRESS,
                mint: mint.publicKey,  // Account address of the NFT we will be minting
                metadata,
                masterEdition,
                mintAuthority: walletAddress.publicKey,
                updateAuthority: walletAddress.publicKey,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
                clock: web3.SYSVAR_CLOCK_PUBKEY,
                recentBlockhashes: web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
                instructionSysvarAccount: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            };

            const signers = [mint];
            const instructions = [
                web3.SystemProgram.createAccount({
                    fromPubkey: walletAddress.publicKey,
                    newAccountPubkey: mint.publicKey,
                    space: MintLayout.span,
                    lamports: rent,
                    programId: TOKEN_PROGRAM_ID,
                }),
                Token.createInitMintInstruction(
                    TOKEN_PROGRAM_ID,
                    mint.publicKey,
                    0,
                    walletAddress.publicKey,
                    walletAddress.publicKey
                ),
                createAssociatedTokenAccountInstruction(
                    token,
                    walletAddress.publicKey,
                    walletAddress.publicKey,
                    mint.publicKey
                ),
                Token.createMintToInstruction(
                    TOKEN_PROGRAM_ID,
                    mint.publicKey,
                    token,
                    walletAddress.publicKey,
                    [],
                    1
                ),
            ];

            const provider = getProvider();
            const idl = await Program.fetchIdl(candyMachineProgramV2, provider);
            const program = new Program(idl, candyMachineProgramV2, provider);

            const txn = await program.rpc.mintNft(creatorBump, {
                accounts,
                signers,
                instructions,
            });
            console.log('txn:', txn);

            // Setup listener
            connection.onSignatureWithOptions(
                txn,
                async (notification, context) => {
                    if (notification.type === 'status') {
                        console.log('Receievd status event');

                        const {result} = notification;
                        if (!result.err) {
                            console.log('NFT Minted!');
                            setIsMinting(false);
                        }
                    }
                },
                {commitment: 'processed'}
            );
        } catch (error) {
            let message = error.msg || 'Minting failed! Please try again!';
            setIsMinting(false);

            if (!error.msg) {
                if (error.message.indexOf('0x138')) {
                } else if (error.message.indexOf('0x137')) {
                    message = `SOLD OUT!`;
                } else if (error.message.indexOf('0x135')) {
                    message = `Insufficient funds to mint. Please fund your wallet.`;
                }
            } else {
                if (error.code === 311) {
                    message = `SOLD OUT!`;
                } else if (error.code === 312) {
                    message = `Minting period hasn't started yet.`;
                }
            }

            console.warn(message);
        }
    };

    const createAssociatedTokenAccountInstruction = (
        associatedTokenAddress,
        payer,
        walletAddress,
        splTokenMintAddress
    ) => {
        const keys = [
            {pubkey: payer, isSigner: true, isWritable: true},
            {pubkey: associatedTokenAddress, isSigner: false, isWritable: true},
            {pubkey: walletAddress, isSigner: false, isWritable: false},
            {pubkey: splTokenMintAddress, isSigner: false, isWritable: false},
            {
                pubkey: web3.SystemProgram.programId,
                isSigner: false,
                isWritable: false,
            },
            {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
            {
                pubkey: web3.SYSVAR_RENT_PUBKEY,
                isSigner: false,
                isWritable: false,
            },
        ];
        return new web3.TransactionInstruction({
            keys,
            programId: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
            data: Buffer.from([]),
        });
    };

    const renderDropTimer = () => {
        const currentDate = new Date();
        const dropDate = new Date(machineStats.goLiveData * 1000);

        return currentDate <= dropDate ?
            (<CountdownTimer dropDate={dropDate} />) :
            (<p>{`Drop Date: ${machineStats.goLiveDateTimeString}`}</p>)
    }

    // Effects
    useEffect(() => {
        getCandyMachineState();
    }, []);

    return (
        <div className="sub-text">
            {renderDropTimer()}
            <p>{`Items Minted: ${machineStats.itemsRedeemed} / ${machineStats.itemsAvailable}`}</p>
            {machineStats.itemsRedeemed === machineStats.itemsAvailable ?
                (<p className="sub-text">Sold Out 🙊</p>) :
                (<button className="cta-button connect-wallet-button" onClick={mintToken} disabled={isMinting}>MINT</button>)
            }
        </div>
    );
};

export default CandyMachine;