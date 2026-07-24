<!--
    WritingRemindersSection.svelte — Feature-gated daily reminder preferences.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import { requestWritingReminderPermission } from "$lib/writingReminders";
import { Plus, X } from "lucide-svelte";
import SettingToggle from "../SettingToggle.svelte";

const { draft, onchange }: { draft: AppSettings; onchange: () => void } = $props();

const weekdays = [
    [0, "S", "Sunday"],
    [1, "M", "Monday"],
    [2, "T", "Tuesday"],
    [3, "W", "Wednesday"],
    [4, "T", "Thursday"],
    [5, "F", "Friday"],
    [6, "S", "Saturday"],
] as const;

let permissionError = $state("");
let requestingPermission = $state(false);

async function toggleEnabled(enabled: boolean): Promise<void> {
    permissionError = "";
    if (enabled) {
        requestingPermission = true;
        try {
            if (!(await requestWritingReminderPermission())) {
                permissionError = "Allow notifications in system settings to enable reminders.";
                return;
            }
        } catch (error) {
            console.error("[writingReminders] permission request failed", error);
            permissionError = "Quillium couldn't request notification permission.";
            return;
        } finally {
            requestingPermission = false;
        }
    }
    draft.writingRemindersEnabled = enabled;
    onchange();
}

function updateTime(index: number, time: string): void {
    draft.writingReminderTimes = draft.writingReminderTimes.map((value, i) =>
        i === index ? time : value,
    );
    onchange();
}

function addTime(): void {
    if (draft.writingReminderTimes.length >= 4) return;
    const previous = draft.writingReminderTimes.at(-1) ?? "09:00";
    const [hour, minute] = previous.split(":").map(Number);
    const next = `${String((hour + 3) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    draft.writingReminderTimes = [...draft.writingReminderTimes, next].sort();
    onchange();
}

function removeTime(index: number): void {
    if (draft.writingReminderTimes.length === 1) return;
    draft.writingReminderTimes = draft.writingReminderTimes.filter((_, i) => i !== index);
    onchange();
}

function toggleDay(day: number): void {
    const selected = draft.writingReminderDays.includes(day);
    if (selected && draft.writingReminderDays.length === 1) return;
    draft.writingReminderDays = selected
        ? draft.writingReminderDays.filter((value) => value !== day)
        : [...draft.writingReminderDays, day].sort((a, b) => a - b);
    onchange();
}
</script>

<div class="section-label">Writing reminders</div>

<SettingToggle
    settingId="writing-reminders"
    title="Daily writing reminders"
    description="Get a system notification when it's time to write"
    checked={draft.writingRemindersEnabled}
    defaultChecked={false}
    ariaLabel="Toggle daily writing reminders"
    disabled={requestingPermission}
    onchange={toggleEnabled}
/>

{#if permissionError}
    <p class="px-0.5 pb-1 text-[11px] text-rose-500">{permissionError}</p>
{/if}

<div class:opacity-40={!draft.writingRemindersEnabled} class:pointer-events-none={!draft.writingRemindersEnabled}>
    <div class="setting-row items-start">
        <div class="setting-meta">
            <div class="setting-title">Preferred times</div>
            <div class="setting-desc">Add up to four reminders in your local time zone</div>
        </div>
        <div class="flex min-w-32 flex-col items-end gap-1.5">
            {#each draft.writingReminderTimes as time, index (`${index}-${time}`)}
                <div class="flex items-center gap-1">
                    <input
                        type="time"
                        value={time}
                        aria-label={`Reminder time ${index + 1}`}
                        class="rounded-md border border-black/10 bg-white/60 px-2 py-1 text-sm"
                        onchange={(event) => updateTime(index, event.currentTarget.value)}
                    />
                    <button
                        type="button"
                        aria-label={`Remove ${time} reminder`}
                        disabled={draft.writingReminderTimes.length === 1}
                        class="rounded p-1 text-black/25 hover:bg-black/5 hover:text-black/50 disabled:opacity-20"
                        onclick={() => removeTime(index)}
                    ><X size={13} /></button>
                </div>
            {/each}
            {#if draft.writingReminderTimes.length < 4}
                <button
                    type="button"
                    class="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600"
                    onclick={addTime}
                ><Plus size={12} /> Add time</button>
            {/if}
        </div>
    </div>

    <div class="setting-row">
        <div class="setting-meta">
            <div class="setting-title">Days</div>
            <div class="setting-desc">Choose daily or a custom weekly rhythm</div>
        </div>
        <div class="flex gap-1" aria-label="Reminder days">
            {#each weekdays as [day, short, label]}
                <button
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={draft.writingReminderDays.includes(day)}
                    class="size-7 rounded-full text-[10px] font-semibold transition-colors {draft.writingReminderDays.includes(day) ? 'bg-blue-500 text-white' : 'bg-black/5 text-black/35 hover:bg-black/10'}"
                    onclick={() => toggleDay(day)}
                >{short}</button>
            {/each}
        </div>
    </div>

    <p class="px-0.5 pt-1 text-[10px] leading-relaxed text-black/30">
        Reminder copy reflects your local writing streak. Notifications follow your system Focus
        and Do Not Disturb settings; in-app reminders can be snoozed for one hour.
    </p>
</div>
