export interface TemporaryVoiceChannelRecord {
    channelId: string;
    guildId: string;
    ownerId: string;
    createdAt: number;
}

export interface TemporaryVoiceChannelStoreData {
    channels: Record<string, TemporaryVoiceChannelRecord>;
}

export interface TemporaryVoiceConfig {
    triggerChannelId: string;
    categoryId: string;
    managerRoleIds: readonly string[];
}
