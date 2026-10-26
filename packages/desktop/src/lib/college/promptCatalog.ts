// promptCatalog.ts — Official prompt wording shared by presets and bundled guidance.

export const UC_PROMPTS = [
    {
        label: "Leadership",
        text: "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes or contributed to group efforts over time.",
    },
    {
        label: "Creativity",
        text: "Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side.",
    },
    {
        label: "Skill",
        text: "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?",
    },
    {
        label: "Education",
        text: "Describe how you have taken advantage of a significant educational opportunity or worked to overcome an educational barrier you have faced.",
    },
    {
        label: "Challenge",
        text: "Describe the most significant challenge you have faced and the steps you have taken to overcome this challenge. How has this challenge affected your academic achievement?",
    },
    {
        label: "Academic interest",
        text: "Think about an academic subject that inspires you. Describe how you have furthered this interest inside and/or outside of the classroom.",
    },
    {
        label: "Community",
        text: "What have you done to make your school or your community a better place?",
    },
    {
        label: "Additional perspective",
        text: "Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?",
    },
] as const;

export const COMMON_APP_PROMPTS = [
    {
        label: "Identity",
        text: "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story.",
    },
    {
        label: "Obstacle",
        text: [
            "The lessons we take from obstacles we encounter can be fundamental to later success.",
            "Recount a time when you faced a challenge, setback, or failure.",
            "How did it affect you, and what did you learn from the experience?",
        ].join(" "),
    },
    {
        label: "Belief",
        text: "Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking? What was the outcome?",
    },
    {
        label: "Gratitude",
        text: "Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. How has this gratitude affected or motivated you?",
    },
    {
        label: "Growth",
        text: "Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.",
    },
    {
        label: "Curiosity",
        text: [
            "Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time.",
            "Why does it captivate you? What or who do you turn to when you want to learn more?",
        ].join(" "),
    },
    {
        label: "Open topic",
        text: [
            "Share an essay on any topic of your choice.",
            "It can be one you've already written, one that responds to a different prompt, or one of your own design.",
        ].join(" "),
    },
] as const;
