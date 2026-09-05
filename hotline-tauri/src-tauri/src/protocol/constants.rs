// Hotline protocol constants
// Error code reference: https://hlwiki.com/index.php/HL_ErrorCodes

/// Hotline protocol error codes.
/// Servers may also send arbitrary error codes; these are the well-known ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum HotlineErrorCode {
    // General
    None = 0,
    Generic = -1,
    NotConnected = 1,
    Socket = 2,
    // Login & Access (1000-1004)
    LoginFailed = 1000,
    AlreadyLoggedIn = 1001,
    AccessDenied = 1002,
    UserBanned = 1003,
    ServerFull = 1004,
    // File & Transfer (2000-2003)
    FileNotFound = 2000,
    FileInUse = 2001,
    DiskFull = 2002,
    TransferFailed = 2003,
    // News & Messaging (3000-3001)
    NewsFull = 3000,
    MsgRefused = 3001,
}

impl HotlineErrorCode {
    /// Try to match a raw error code to a known variant.
    pub fn from_code(code: u32) -> Option<Self> {
        // error_code is u32 in the transaction header but some codes are negative in the spec
        match code as i32 {
            0 => Some(Self::None),
            -1 => Some(Self::Generic),
            1 => Some(Self::NotConnected),
            2 => Some(Self::Socket),
            1000 => Some(Self::LoginFailed),
            1001 => Some(Self::AlreadyLoggedIn),
            1002 => Some(Self::AccessDenied),
            1003 => Some(Self::UserBanned),
            1004 => Some(Self::ServerFull),
            2000 => Some(Self::FileNotFound),
            2001 => Some(Self::FileInUse),
            2002 => Some(Self::DiskFull),
            2003 => Some(Self::TransferFailed),
            3000 => Some(Self::NewsFull),
            3001 => Some(Self::MsgRefused),
            _ => None,
        }
    }

    /// Human-readable fallback message for when the server doesn't send ErrorText.
    pub fn default_message(&self) -> &'static str {
        match self {
            Self::None => "No error",
            Self::Generic => "A non-specific error occurred",
            Self::NotConnected => "The connection is no longer active",
            Self::Socket => "A network socket error occurred",
            Self::LoginFailed => "Invalid login credentials",
            Self::AlreadyLoggedIn => "Already logged in to this server",
            Self::AccessDenied => "Access denied — you lack the required permissions",
            Self::UserBanned => "Banned from this server",
            Self::ServerFull => "Server is full",
            Self::FileNotFound => "File or folder not found",
            Self::FileInUse => "File is in use by another process",
            Self::DiskFull => "Server disk is full",
            Self::TransferFailed => "File transfer failed",
            Self::NewsFull => "News database is full",
            Self::MsgRefused => "Recipient has refused private messages",
        }
    }
}

/// Resolve a transaction error code to a human-readable message.
/// Prefers the server-provided ErrorText; falls back to known error code descriptions.
pub fn resolve_error_message(error_code: u32, server_error_text: Option<String>) -> String {
    if let Some(text) = server_error_text {
        if !text.is_empty() {
            return text;
        }
    }
    match HotlineErrorCode::from_code(error_code) {
        Some(known) => known.default_message().to_string(),
        None => format!("Unknown error (code {})", error_code),
    }
}

#[cfg(test)]
mod tests {
    use super::{access_bit, resolve_error_message, HotlineErrorCode, ACCESS_SEND_MEDIA};

    #[test]
    fn access_bit_uses_msb_first_numbering() {
        // Hotline AccessBitmap: spec "bit n" is MSB-first, i.e. u64 bit (63 - n)
        // when the 8-byte field is read as a big-endian u64.
        assert_eq!(access_bit(0), 1u64 << 63); // DeleteFile = highest u64 bit
        assert_eq!(access_bit(57), 1u64 << 6); // AccessSendMedia
        assert_eq!(access_bit(63), 1u64); // last spec bit = lowest u64 bit
        assert_eq!(ACCESS_SEND_MEDIA, access_bit(57));
    }

    #[test]
    fn access_bit_57_matches_wire_bytes() {
        // Byte-level cross-check: spec bit 57 lives in byte 7 (57/8), at
        // intra-byte bit (7 - 57%8) = 6 → 0x40. Big-endian u64 of those bytes
        // must equal ACCESS_SEND_MEDIA.
        let wire: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0x40];
        assert_eq!(u64::from_be_bytes(wire), ACCESS_SEND_MEDIA);
    }

    #[test]
    fn error_code_from_code_matches_known_values() {
        assert_eq!(HotlineErrorCode::from_code(0), Some(HotlineErrorCode::None));
        assert_eq!(HotlineErrorCode::from_code(u32::from_ne_bytes((-1i32).to_ne_bytes())), Some(HotlineErrorCode::Generic));
        assert_eq!(HotlineErrorCode::from_code(1), Some(HotlineErrorCode::NotConnected));
        assert_eq!(HotlineErrorCode::from_code(2), Some(HotlineErrorCode::Socket));
        assert_eq!(HotlineErrorCode::from_code(1000), Some(HotlineErrorCode::LoginFailed));
        assert_eq!(HotlineErrorCode::from_code(1001), Some(HotlineErrorCode::AlreadyLoggedIn));
        assert_eq!(HotlineErrorCode::from_code(1002), Some(HotlineErrorCode::AccessDenied));
        assert_eq!(HotlineErrorCode::from_code(1003), Some(HotlineErrorCode::UserBanned));
        assert_eq!(HotlineErrorCode::from_code(1004), Some(HotlineErrorCode::ServerFull));
        assert_eq!(HotlineErrorCode::from_code(2000), Some(HotlineErrorCode::FileNotFound));
        assert_eq!(HotlineErrorCode::from_code(2001), Some(HotlineErrorCode::FileInUse));
        assert_eq!(HotlineErrorCode::from_code(2002), Some(HotlineErrorCode::DiskFull));
        assert_eq!(HotlineErrorCode::from_code(2003), Some(HotlineErrorCode::TransferFailed));
        assert_eq!(HotlineErrorCode::from_code(3000), Some(HotlineErrorCode::NewsFull));
        assert_eq!(HotlineErrorCode::from_code(3001), Some(HotlineErrorCode::MsgRefused));
        assert_eq!(HotlineErrorCode::from_code(9999), None);
    }

    #[test]
    fn resolve_error_prefers_server_text() {
        let msg = resolve_error_message(1000, Some("Server says nope".to_string()));
        assert_eq!(msg, "Server says nope");
    }

    #[test]
    fn resolve_error_falls_back_to_known_code_message() {
        let msg = resolve_error_message(1000, None);
        assert_eq!(msg, HotlineErrorCode::LoginFailed.default_message());
    }

    #[test]
    fn resolve_error_handles_empty_server_text() {
        let msg = resolve_error_message(1000, Some(String::new()));
        assert_eq!(msg, HotlineErrorCode::LoginFailed.default_message());
    }

    #[test]
    fn resolve_error_handles_unknown_code() {
        let msg = resolve_error_message(4242, None);
        assert_eq!(msg, "Unknown error (code 4242)");
    }
}

// Protocol identifiers
pub const PROTOCOL_ID: &[u8; 4] = b"TRTP";
pub const SUBPROTOCOL_ID: &[u8; 4] = b"HOTL";
pub const FILE_TRANSFER_ID: &[u8; 4] = b"HTXF";
pub const PROTOCOL_VERSION: u16 = 0x0001;
pub const PROTOCOL_SUBVERSION: u16 = 0x0002;

// Transaction header size
pub const TRANSACTION_HEADER_SIZE: usize = 20;

/// Maximum allowed transaction body size (10 MB).
/// Hotline protocol transactions (chat, user lists, news, file listings) are
/// never legitimately this large. File data uses separate HTXF transfers.
pub const MAX_TRANSACTION_BODY_SIZE: u32 = 10 * 1024 * 1024;

// Default ports
pub const DEFAULT_SERVER_PORT: u16 = 5500;
pub const DEFAULT_TLS_PORT: u16 = 5600;
pub const DEFAULT_TRACKER_PORT: u16 = 5498;

// Capability flags (DATA_CAPABILITIES bitmask, per fogWraith Capabilities spec).
// Per spec: "implementations should use a width that accommodates future growth.
// An 8-byte (64-bit) field provides 64 capability slots."
pub const CAPABILITY_MODERN_DATES: u64 = 0x0200; // bit 9
pub const CAPABILITY_LARGE_FILES: u64 = 0x0001; // bit 0
pub const CAPABILITY_TEXT_ENCODING: u64 = 0x0002; // bit 1 (UTF-8)
pub const CAPABILITY_VOICE: u64 = 0x0004; // bit 2 (WebRTC)
pub const CAPABILITY_INLINE_MEDIA: u64 = 0x0008; // bit 3
pub const CAPABILITY_CHAT_HISTORY: u64 = 0x0010; // bit 4
pub const CAPABILITY_EXTENDED_PRIV: u64 = 0x0020; // bit 5 (provisional — DO NOT advertise)

// Account access privilege bits (FieldUserAccess 110).
// Hotline's AccessBitmap uses MSB-first bit numbering: spec "bit n" maps to
// u64 bit (63 - n) when the 8-byte field is read as a big-endian u64.
pub const fn access_bit(n: u32) -> u64 {
    1u64 << (63 - n)
}
pub const ACCESS_SEND_MEDIA: u64 = access_bit(57); // AccessSendMedia (inline media)

// HTXF transfer flags
pub const HTXF_FLAG_LARGE_FILE: u32 = 0x00000001;
pub const HTXF_FLAG_SIZE64: u32 = 0x00000002;
pub const HTXF_FLAG_RESUME: u32 = 0x00000004;

// Transaction types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum TransactionType {
    Reply = 0,
    Error = 100,
    GetMessageBoard = 101,
    NewMessage = 102,
    OldPostNews = 103,
    ServerMessage = 104,
    SendChat = 105,
    ChatMessage = 106,
    Login = 107,
    SendInstantMessage = 108,
    ShowAgreement = 109,
    DisconnectUser = 110,
    DisconnectMessage = 111,
    InviteToNewChat = 112,
    InviteToChat = 113,
    RejectChatInvite = 114,
    JoinChat = 115,
    LeaveChat = 116,
    NotifyChatOfUserChange = 117,
    NotifyChatOfUserDelete = 118,
    NotifyChatSubject = 119,
    SetChatSubject = 120,
    Agreed = 121,
    ServerBanner = 122,
    GetFileNameList = 200,
    DownloadFile = 202,
    UploadFile = 203,
    DeleteFile = 204,
    NewFolder = 205,
    GetFileInfo = 206,
    SetFileInfo = 207,
    MoveFile = 208,
    MakeFileAlias = 209,
    DownloadFolder = 210,
    DownloadInfo = 211,
    DownloadBanner = 212,
    UploadFolder = 213,
    GetUserNameList = 300,
    NotifyUserChange = 301,
    NotifyUserDelete = 302,
    GetClientInfoText = 303,
    SetClientUserInfo = 304,
    ListUsers = 348,
    UpdateUser = 349,
    NewUser = 350,
    DeleteUser = 351,
    GetUser = 352,
    SetUser = 353,
    UserAccess = 354,
    UserBroadcast = 355,
    GetNewsCategoryList = 370,
    GetNewsArticleList = 371,
    DeleteNewsItem = 380,
    NewNewsFolder = 381,
    NewNewsCategory = 382,
    GetNewsArticleData = 400,
    PostNewsArticle = 410,
    DeleteNewsArticle = 411,
    KeepAlive = 500,
    GetChatHistory = 700,
    // Inline-media extension (capability bit 3)
    UploadMedia = 750,    // 0x02EE
    DownloadMedia = 751,  // 0x02EF
    Unknown = 0xFFFF,
}

impl From<u16> for TransactionType {
    fn from(value: u16) -> Self {
        match value {
            0 => Self::Reply,
            100 => Self::Error,
            101 => Self::GetMessageBoard,
            102 => Self::NewMessage,
            103 => Self::OldPostNews,
            104 => Self::ServerMessage,
            105 => Self::SendChat,
            106 => Self::ChatMessage,
            107 => Self::Login,
            108 => Self::SendInstantMessage,
            109 => Self::ShowAgreement,
            110 => Self::DisconnectUser,
            111 => Self::DisconnectMessage,
            112 => Self::InviteToNewChat,
            113 => Self::InviteToChat,
            114 => Self::RejectChatInvite,
            115 => Self::JoinChat,
            116 => Self::LeaveChat,
            117 => Self::NotifyChatOfUserChange,
            118 => Self::NotifyChatOfUserDelete,
            119 => Self::NotifyChatSubject,
            120 => Self::SetChatSubject,
            121 => Self::Agreed,
            122 => Self::ServerBanner,
            200 => Self::GetFileNameList,
            202 => Self::DownloadFile,
            203 => Self::UploadFile,
            204 => Self::DeleteFile,
            205 => Self::NewFolder,
            206 => Self::GetFileInfo,
            207 => Self::SetFileInfo,
            208 => Self::MoveFile,
            209 => Self::MakeFileAlias,
            210 => Self::DownloadFolder,
            211 => Self::DownloadInfo,
            212 => Self::DownloadBanner,
            213 => Self::UploadFolder,
            300 => Self::GetUserNameList,
            301 => Self::NotifyUserChange,
            302 => Self::NotifyUserDelete,
            303 => Self::GetClientInfoText,
            304 => Self::SetClientUserInfo,
            348 => Self::ListUsers,
            349 => Self::UpdateUser,
            350 => Self::NewUser,
            351 => Self::DeleteUser,
            352 => Self::GetUser,
            353 => Self::SetUser,
            354 => Self::UserAccess,
            355 => Self::UserBroadcast,
            370 => Self::GetNewsCategoryList,
            371 => Self::GetNewsArticleList,
            380 => Self::DeleteNewsItem,
            381 => Self::NewNewsFolder,
            382 => Self::NewNewsCategory,
            400 => Self::GetNewsArticleData,
            410 => Self::PostNewsArticle,
            411 => Self::DeleteNewsArticle,
            500 => Self::KeepAlive,
            700 => Self::GetChatHistory,
            750 => Self::UploadMedia,
            751 => Self::DownloadMedia,
            _ => Self::Unknown,
        }
    }
}

// Field types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum FieldType {
    ErrorText = 100,
    Data = 101,
    UserName = 102,
    UserId = 103,
    UserIconId = 104,
    UserLogin = 105,
    UserPassword = 106,
    ReferenceNumber = 107,
    TransferSize = 108,
    ChatOptions = 109,
    UserAccess = 110,
    UserAlias = 111,
    UserFlags = 112,
    Options = 113,
    ChatId = 114,
    ChatSubject = 115,
    WaitingCount = 116,
    ServerAgreement = 150,
    ServerBanner = 151,
    ServerBannerType = 152,
    ServerBannerUrl = 153,
    NoServerAgreement = 154,
    VersionNumber = 160,
    CommunityBannerId = 161,
    ServerName = 162,
    FileNameWithInfo = 200,
    FileName = 201,
    FilePath = 202,
    FileResumeData = 203,
    FileTransferOptions = 204,
    FileTypeString = 205,
    FileCreatorString = 206,
    FileSize = 207,
    FileCreateDate = 208,
    FileModifyDate = 209,
    FileComment = 210,
    FileNewName = 211,
    FileNewPath = 212,
    FileType = 213,
    QuotingMessage = 214,
    AutomaticResponse = 215,
    FolderItemCount = 220,
    UserNameWithInfo = 300,
    NewsCategoryGuid = 319,
    NewsCategoryListData = 320,
    NewsArticleListData = 321,
    NewsCategoryName = 322,
    NewsCategoryListData15 = 323,
    NewsPath = 325,
    NewsArticleId = 326,
    NewsArticleDataFlavor = 327,
    NewsArticleTitle = 328,
    NewsArticlePoster = 329,
    NewsArticleDate = 330,
    NewsArticlePrevious = 331,
    NewsArticleNext = 332,
    NewsArticleData = 333,
    NewsArticleFlags = 334,
    NewsArticleParentArticle = 335,
    NewsArticleFirstChildArticle = 336,
    NewsArticleRecursiveDelete = 337,
    // Large file extension fields
    Capabilities = 496,       // 0x01F0
    FileSize64 = 497,         // 0x01F1
    PartialDigest = 506,
    Offset64 = 498,           // 0x01F2
    TransferSize64 = 499,     // 0x01F3
    FolderItemCount64 = 500,  // 0x01F4
    // Inline-media extension (capability bit 3)
    ChatMediaType = 513,           // 0x0201 — canonical MIME (string ≤64)
    ChatMediaId = 514,             // 0x0202 — opaque handle (binary ≤64)
    ChatMediaPayload = 515,        // 0x0203 — image bytes (upload/download only)
    ChatMediaDeclaredType = 516,   // 0x0204 — sender hint, upload only
    ChatMediaWidth = 517,          // 0x0205 — server-supplied u32
    ChatMediaHeight = 518,         // 0x0206 — server-supplied u32
    ChatMediaBytes = 519,          // 0x0207 — server-supplied u32
    ChatMediaUploadToken = 520,    // 0x0208 — chunked-upload session token
    ChatMediaPartIndex = 521,      // 0x0209 — u16 chunk index
    ChatMediaPartCount = 522,      // 0x020A — u16 total chunks
    ChatMediaPartFinal = 523,      // 0x020B — u8 non-zero on final chunk
    ChatMediaMaxBytes = 524,
    ChatMediaMaxDimension = 525,
    ChatMediaMaxPixels = 526,
    ChatMediaChunkSize = 527,
    ChatMediaMaxFrames = 528,
    ChatMediaMaxDurationMs = 529,
    // Colored nicknames extension
    NickColor = 1280,              // 0x0500 - DATA_COLOR (32-bit 0x00RRGGBB)
    // HOPE (Hotline One-time Password Extension) fields
    HopeAppId = 3585,              // 0x0E01
    HopeAppString = 3586,          // 0x0E02
    HopeSessionKey = 3587,         // 0x0E03
    HopeMacAlgorithm = 3588,       // 0x0E04
    HopeServerCipher = 3777,       // 0x0EC1
    HopeClientCipher = 3778,       // 0x0EC2
    HopeServerCipherMode = 3779,   // 0x0EC3
    HopeClientCipherMode = 3780,   // 0x0EC4
    HopeServerIV = 3781,           // 0x0EC5
    HopeClientIV = 3782,           // 0x0EC6
    HopeServerChecksum = 3783,     // 0x0EC7
    HopeClientChecksum = 3784,     // 0x0EC8
    HopeServerCompression = 3785,  // 0x0EC9
    HopeClientCompression = 3786,  // 0x0ECA
    // Chat history extension fields
    ChannelId = 3841,              // 0x0F01
    HistoryBefore = 3842,          // 0x0F02
    HistoryAfter = 3843,           // 0x0F03
    HistoryLimit = 3844,           // 0x0F04
    HistoryEntry = 3845,           // 0x0F05
    HistoryHasMore = 3846,         // 0x0F06
    HistoryMaxMsgs = 3847,         // 0x0F07
    HistoryMaxDays = 3848,         // 0x0F08
}

impl From<u16> for FieldType {
    fn from(value: u16) -> Self {
        match value {
            100 => Self::ErrorText,
            101 => Self::Data,
            102 => Self::UserName,
            103 => Self::UserId,
            104 => Self::UserIconId,
            105 => Self::UserLogin,
            106 => Self::UserPassword,
            107 => Self::ReferenceNumber,
            108 => Self::TransferSize,
            109 => Self::ChatOptions,
            110 => Self::UserAccess,
            111 => Self::UserAlias,
            112 => Self::UserFlags,
            113 => Self::Options,
            114 => Self::ChatId,
            115 => Self::ChatSubject,
            116 => Self::WaitingCount,
            150 => Self::ServerAgreement,
            151 => Self::ServerBanner,
            152 => Self::ServerBannerType,
            153 => Self::ServerBannerUrl,
            154 => Self::NoServerAgreement,
            160 => Self::VersionNumber,
            161 => Self::CommunityBannerId,
            162 => Self::ServerName,
            200 => Self::FileNameWithInfo,
            201 => Self::FileName,
            202 => Self::FilePath,
            203 => Self::FileResumeData,
            204 => Self::FileTransferOptions,
            205 => Self::FileTypeString,
            206 => Self::FileCreatorString,
            207 => Self::FileSize,
            208 => Self::FileCreateDate,
            209 => Self::FileModifyDate,
            210 => Self::FileComment,
            211 => Self::FileNewName,
            212 => Self::FileNewPath,
            213 => Self::FileType,
            214 => Self::QuotingMessage,
            215 => Self::AutomaticResponse,
            220 => Self::FolderItemCount,
            300 => Self::UserNameWithInfo,
            319 => Self::NewsCategoryGuid,
            320 => Self::NewsCategoryListData,
            321 => Self::NewsArticleListData,
            322 => Self::NewsCategoryName,
            323 => Self::NewsCategoryListData15,
            325 => Self::NewsPath,
            326 => Self::NewsArticleId,
            327 => Self::NewsArticleDataFlavor,
            328 => Self::NewsArticleTitle,
            329 => Self::NewsArticlePoster,
            330 => Self::NewsArticleDate,
            331 => Self::NewsArticlePrevious,
            332 => Self::NewsArticleNext,
            333 => Self::NewsArticleData,
            334 => Self::NewsArticleFlags,
            335 => Self::NewsArticleParentArticle,
            336 => Self::NewsArticleFirstChildArticle,
            337 => Self::NewsArticleRecursiveDelete,
            496 => Self::Capabilities,
            497 => Self::FileSize64,
            506 => Self::PartialDigest,
            498 => Self::Offset64,
            499 => Self::TransferSize64,
            500 => Self::FolderItemCount64,
            513 => Self::ChatMediaType,
            514 => Self::ChatMediaId,
            515 => Self::ChatMediaPayload,
            516 => Self::ChatMediaDeclaredType,
            517 => Self::ChatMediaWidth,
            518 => Self::ChatMediaHeight,
            519 => Self::ChatMediaBytes,
            520 => Self::ChatMediaUploadToken,
            521 => Self::ChatMediaPartIndex,
            522 => Self::ChatMediaPartCount,
            523 => Self::ChatMediaPartFinal,
            524 => Self::ChatMediaMaxBytes,
            525 => Self::ChatMediaMaxDimension,
            526 => Self::ChatMediaMaxPixels,
            527 => Self::ChatMediaChunkSize,
            528 => Self::ChatMediaMaxFrames,
            529 => Self::ChatMediaMaxDurationMs,

            1280 => Self::NickColor,
            3585 => Self::HopeAppId,
            3586 => Self::HopeAppString,
            3587 => Self::HopeSessionKey,
            3588 => Self::HopeMacAlgorithm,
            3777 => Self::HopeServerCipher,
            3778 => Self::HopeClientCipher,
            3779 => Self::HopeServerCipherMode,
            3780 => Self::HopeClientCipherMode,
            3781 => Self::HopeServerIV,
            3782 => Self::HopeClientIV,
            3783 => Self::HopeServerChecksum,
            3784 => Self::HopeClientChecksum,
            3785 => Self::HopeServerCompression,
            3786 => Self::HopeClientCompression,
            3841 => Self::ChannelId,
            3842 => Self::HistoryBefore,
            3843 => Self::HistoryAfter,
            3844 => Self::HistoryLimit,
            3845 => Self::HistoryEntry,
            3846 => Self::HistoryHasMore,
            3847 => Self::HistoryMaxMsgs,
            3848 => Self::HistoryMaxDays,
            _ => Self::ErrorText, // Default fallback
        }
    }
}
