-- CreateTable
CREATE TABLE "Intent" (
    "id" SERIAL NOT NULL,
    "greetingMessage" TEXT NOT NULL,
    "conversationTopic" TEXT NOT NULL,
    "endingMessage" TEXT NOT NULL,
    "questions" TEXT[],
    "businessInfo" TEXT NOT NULL,
    "businessId" INTEGER NOT NULL,

    CONSTRAINT "Intent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
